import argparse
import datetime
import os
import sys
from pathlib import Path

from .utils import generate_experiment_context
import web
from web.contrib.template import render_jinja

from .preprocess import raw_to_df

web.config.debug = False

package_dir = os.path.dirname(os.path.abspath(__file__))

urls = ("/", "serve", "/serve", "serve", "/decline", "decline", "/reset", "reset")

app = web.application(urls, globals())


# Function to create a session with unique storage based on port
def get_session(port=8080):
    session_path = Path(package_dir, f"sessions_{port}")
    session_path.mkdir(exist_ok=True)
    return web.session.Session(
        app,
        web.session.DiskStore(session_path),
        initializer={"incomplete": None},
    )


# Default session - will be replaced in run()
session = get_session()


def create_parser() -> argparse.ArgumentParser:
    """Create an argument parser for the serve command.

    Returns:
        argparse.ArgumentParser: The argument parser.
    """
    parser = argparse.ArgumentParser(
        description="Start a local deployment of a battery"
    )

    # Move exp_config into the mutually exclusive group AFTER creating it
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "-e",
        "--exps",
        help="Comma delimited list of paths to experiments. Mutually exclusive with exp_config",
        type=lambda x: [Path(y) for y in x.split(",")],
    )
    group.add_argument(
        "-c",
        "--config",
        dest="exp_config",
        metavar="EXP_CONFIG",
        type=Path,
        help=(
            "Path to a single experiment or path to a configuration file. "
            "Configuration file should be a single path to an experiment per line."
        ),
    )
    parser.add_argument(
        "-gi",
        "--group_index",
        help="Inject a group_index variable into the experiment context.",
    )

    # NOTE: Below are additional arguments
    # for formatting the data outputs into
    # directories and files that follow BIDS naming conventions.
    parser.add_argument("-sub", "--subject_id", help="Subject ID")
    parser.add_argument("-ses", "--session_num", help="Session Number")
    parser.add_argument("-run", "--run_num", help="Run Number")

    # Output paths for BIDS and RAW data
    parser.add_argument("-raw", "--raw_dir", help="Path to raw data")
    parser.add_argument("-bids", "--bids_dir", help="Path to bids data")

    return parser


parser = create_parser()

experiments = []

template_dir = Path(package_dir, "templates")
static_dir = Path(package_dir, "static/")
experiments_dir = Path(static_dir, "experiments/")
render = render_jinja(template_dir, encoding="utf-8")


def run(args=None):
    args = parser.parse_args(args)
    if args.exps is not None:
        experiments = args.exps
    elif args.exp_config is not None:
        if args.exp_config.is_file():
            with open(args.exp_config) as fp:
                experiments = [Path(x.strip()) for x in fp.readlines()]
        else:
            experiments = [args.exp_config]
    else:
        print("Found arguments:")
        print(args)
        print()
        parser.print_help()
        sys.exit()

    experiments = [e.absolute() for e in experiments if e.exists()]

    if len(experiments) == 0:
        print("No Experiments Found")
        sys.exit()

    for experiment in experiments:
        try:
            os.mkdir(experiments_dir)
        except FileExistsError:
            pass
        try:
            os.symlink(experiment, Path(experiments_dir, experiment.stem))
        except FileExistsError:
            os.unlink(Path(experiments_dir, experiment.stem))
            os.symlink(experiment, Path(experiments_dir, experiment.stem))

    config_updates = {
        "experiments": experiments,
    }

    # Add params if not None
    optional_params = ["raw_dir", "bids_dir", "subject_id", "session_num", "run_num"]
    for param in optional_params:
        value = getattr(args, param)
        if value is not None:
            config_updates[param] = value

    web.config.update(config_updates)

    if args.group_index is not None:
        web.config.update({"group_index": args.group_index})

    # webpy is opinionated about sys.argv. Set it to something it can handle
    port = 8080
    sys.argv = [None, str(port)]

    started = False
    while port < 10000 and not started:
        try:
            # Update session with port-specific storage
            global session
            session = get_session(port)

            sys.argv = [None, str(port)]
            print(f"Starting server on port {port}")
            app.run()
            started = True
        except OSError as e:
            print(f"Port {port} is in use, trying next port...")
            port += 1
            sys.argv = [None, str(port)]


def serve_experiment(experiment):
    exp_name = experiment.stem
    context = generate_experiment_context(
        Path(experiments_dir, exp_name), "/", f"/static/experiments/{exp_name}"
    )
    if web.config.get("group_index", None):
        context["group_index"] = web.config.group_index
    return render.deploy_template(**context)


class reset:
    def GET(self):
        session.kill()
        return '<html><body>Reset session, <a href="/">back to / </a></body></html>'


class serve:
    def GET(self):
        experiments = web.config.experiments
        if session.get("experiments") is None:
            session.experiments = [*experiments]
        if set(experiments) != set(session.experiments):
            session.experiments = [*experiments]
            session.incomplete = [*experiments]
        if session.get("incomplete") is None:
            session.incomplete = [*experiments]

        if len(session.incomplete) == 0:
            return render.finished()
        exp_to_serve = session.incomplete[-1]
        return serve_experiment(exp_to_serve)

    def POST(self):
        # Get the data first to ensure we can process it regardless of session state
        data = web.data()
        date = str(int(datetime.datetime.now(datetime.timezone.utc).timestamp()))

        # Try to get the experiment name from the session
        try:
            if session.get("incomplete") is None or len(session.incomplete) == 0:
                # If session.incomplete is None or empty, try to reinitialize from web.config
                if hasattr(web.config, "experiments") and web.config.experiments:
                    session.incomplete = [*web.config.experiments]

            # Only pop if we have items
            if session.incomplete and len(session.incomplete) > 0:
                exp_name = session.incomplete.pop()
            else:
                # If we still don't have experiments, use a default name
                exp_name = Path("unknown_experiment")
                print(
                    "Warning: No experiments in session.incomplete, using default name"
                )
        except Exception as e:
            # Handle any other session-related errors
            print(f"Error accessing session data: {e}")
            exp_name = Path("unknown_experiment")

        # Process the data
        df, exp_id = raw_to_df(data)

        # Base filename for raw data
        raw_datafile = f"task-{exp_id}_dateTime-{date}.json"
        events_datafile = f"task-{exp_id}.csv"

        # Get metadata from web.config
        subject_id = getattr(web.config, "subject_id", None)
        session_num = getattr(web.config, "session_num", None)
        run_num = getattr(web.config, "run_num", None)
        raw_dir = getattr(web.config, "raw_dir", None)
        bids_dir = getattr(web.config, "bids_dir", None)

        # Build BIDS-compliant filename prefix
        prefix = ""
        if subject_id:
            prefix += f"sub-{subject_id}_"
        if session_num:
            prefix += f"ses-{session_num}_"
        if run_num:
            prefix += f"run-{run_num}_"

        # Apply prefix to filenames
        raw_filename = f"{prefix}{raw_datafile}"
        events_filename = f"{prefix}{events_datafile}"

        # Setup paths for raw data
        raw_path = raw_filename
        if raw_dir:
            if subject_id:
                # Create subject directory
                sub_dir = os.path.join(raw_dir, f"sub-{subject_id}")
                os.makedirs(sub_dir, exist_ok=True)

                if session_num:
                    # Create session directory
                    ses_dir = os.path.join(sub_dir, f"ses-{session_num}")
                    os.makedirs(ses_dir, exist_ok=True)
                    raw_path = os.path.join(ses_dir, raw_filename)
                else:
                    raw_path = os.path.join(sub_dir, raw_filename)
            else:
                os.makedirs(raw_dir, exist_ok=True)
                raw_path = os.path.join(raw_dir, raw_filename)

        # Save raw data
        with open(raw_path, "wb") as fp:
            fp.write(data)
            print(f"Saved raw data to: {raw_path}")

        # Setup and save BIDS events file if this is an fMRI experiment
        exp_stem = getattr(exp_name, "stem", str(exp_name))
        if bids_dir and exp_stem and "__fmri" in exp_stem:
            bids_path = events_filename

            # Create BIDS directory structure
            if subject_id:
                sub_dir = os.path.join(bids_dir, f"sub-{subject_id}")
                os.makedirs(sub_dir, exist_ok=True)

                if session_num:
                    ses_dir = os.path.join(sub_dir, f"ses-{session_num}")
                    func_dir = os.path.join(ses_dir, "func")
                    os.makedirs(func_dir, exist_ok=True)
                    bids_path = os.path.join(func_dir, events_filename)
                else:
                    func_dir = os.path.join(sub_dir, "func")
                    os.makedirs(func_dir, exist_ok=True)
                    bids_path = os.path.join(func_dir, events_filename)
            else:
                os.makedirs(bids_dir, exist_ok=True)
                bids_path = os.path.join(bids_dir, events_filename)

            # Save BIDS events file
            df.to_csv(bids_path, index=False)
            print(f"Saved BIDS events to: {bids_path}")

        web.header("Content-Type", "application/json")
        return "{'success': true}"


class decline:
    def GET(self, name):
        app.stop()


if __name__ == "__main__":
    run()
