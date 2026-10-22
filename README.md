# fixedssd_replicate

A jsPsych 7 replication of the E-Prime stop-signal task **SimpleStoppingFixedSSDs** (Patrick Bissett). It runs in Chrome on a local [Experiment Factory](https://github.com/expfactory) server. Everything needed is in this repo: the task, its stimuli, the server, and jsPsych. Nothing is loaded from the internet while the task runs.

## Quick start

Requires macOS or Linux, Python 3.11+, and Chrome.

```bash
git clone https://github.com/Runyi0121/fixedssd_replicate.git
cd fixedssd_replicate
chmod +x run.sh
./run.sh -sub s03 -ses 1 -gi 3
```

Then open **http://localhost:8080** in Chrome. If port 8080 is busy, the server tries 8081, 8082 and so on, and prints the port it used.

The first run creates a `.venv` folder and installs the server into it, which takes about a minute. Later runs start right away. Stop the server with `Ctrl+C`.

### Options

| Flag | Meaning |
|---|---|
| `-gi <number>` | **Numeric subject number.** Sets the counterbalanced key mapping (subject number mod 6, same as E-Prime). If omitted, the task asks for subject and session on screen. |
| `-sub <id>` | Subject ID, used only in output folder and file names (e.g. `s03`). |
| `-ses <n>` | Session number, used only in output names. |
| `-run <n>` | Optional run number, used only in output names. |

`-sub` can be any text, but the key mapping needs a number, so pass both (for example `-sub s03 -gi 3`).

### Data

When the participant finishes, the browser sends the data to the server, which saves it as:

```
data/raw/sub-<sub>/ses-<ses>/sub-<sub>_ses-<ses>_task-simple_stopping_fixed_ssds_dateTime-<unix time>.json
```

The file is JSON. Its `trialdata` field is a JSON string holding one row per jsPsych trial. The analysis rows are those with `trial_id == "target"`, one per task trial:

| Column | Meaning |
|---|---|
| `block` | `go_practice`, `stop_practice`, or `main_1` … `main_5` |
| `trial_num` | Trial number within the block |
| `condition` | `go` or `stop` |
| `shape` | `triangle`, `square`, `circle`, `rhombus` |
| `correct_response` | Correct key on go trials (`z`/`m`); empty on stop trials |
| `response` | First key pressed from shape onset to the end of the response window (empty if none) |
| `rt` | Reaction time in ms from shape onset |
| `SSD` | Stop-signal delay in ms (stop trials only) |
| `fixation_response` | Key pressed during the fixation cross (stop trials only) |
| `stop_success` | 1 if no key was pressed at any point in a stop trial |
| `acc` | Go trials: 1 if correct key. Stop trials: same as `stop_success` |
| `subject_number`, `session_number` | From `-gi` or the start-up form |

Data is only saved when the task reaches the end. Refreshing the page restarts the task, and nothing from the partial run is saved.

Load it in Python like this:

```python
import json, pandas as pd
raw = json.load(open(path))
df = pd.DataFrame(json.loads(raw["trialdata"]))
trials = df[df.trial_id == "target"]
```

## Task

Stimuli are the original E-Prime images and tone: black shapes about 100 px across, and `500Hz.wav`, a 100 ms beep.

**Session order**
1. Instructions and response-key mapping
2. **Go practice:** 12 trials, each shape 3 times, no beeps. Feedback follows.
3. Stop-signal instructions, then **stop practice:** 12 trials (8 go, 4 stop), SSD fixed at 250 ms. Feedback follows.
4. **Main task:** 5 blocks of 240 trials, with rest and feedback (mean go RT, go accuracy %) after each block, then a 3 s red "GET READY!!" screen
5. End screen. The experimenter presses **9** to finish.

**Trial timing** (same for go and stop trials)

| Event | Duration |
|---|---|
| Fixation `+` | 500 ms |
| Shape | 850 ms |
| Blank | 1000 ms |

- Responses are recorded from shape onset for 1850 ms, which covers the shape and the blank. Only the first key counts.
- A key press never ends the trial early, so every trial lasts 2350 ms.
- On stop trials the beep plays SSD ms after shape onset. Any key press during the trial, including during the cross, is a failed stop.

**Trial counts:** the main task draws from one pool of 960 go and 240 stop trials spread over the 5 blocks, as in E-Prime, so the go/stop split differs a little from block to block. Each SSD of 100, 200, 300, 400 and 500 ms is used exactly 48 times. The shape on each trial is picked at random.

**Key mapping:** by subject number mod 6.

| mod 6 | Triangle | Circle | Square | Rhombus |
|---|---|---|---|---|
| 1 | Z | Z | M | M |
| 2 | Z | M | Z | M |
| 3 | Z | M | M | Z |
| 4 | M | Z | Z | M |
| 5 | M | Z | M | Z |
| 0 | M | M | Z | Z |

### Differences from the E-Prime version

- **Feedback RT:** the mean RT shown on screen averages only go trials that had a response. E-Prime counted missed trials as 0 ms, which pulled the mean down. The saved data is not affected.
- **Typo fix:** "f the computer emits a beep" in the review screen now reads "If the computer emits a beep".
- **Image format:** the shape images were converted from BMP to PNG without loss. The originals are in `eprime_original/`.
- **Full screen:** the task opens full screen with a button at the start. The click also lets the browser play sound.
- **Beep timing:** the beep is timed with the Web Audio clock, so SSDs are accurate to within a few ms. Screen timing depends on the monitor's refresh rate, as in any browser task.

## Repository layout

```
run.sh                         set up .venv on first run, then start the server
requirements.txt               pinned Python dependencies
simple_stopping_fixed_ssds/    the task (folder name must stay as is; file paths depend on it)
  config.json                  scripts the server loads
  experiment.js                task code
  style.css
  stimuli/                     triangle/square/circle/rhombus.png, 500Hz.wav
expfactory_deploy_local/       bundled local Experiment Factory server, with jsPsych 7.3.1 in static/
eprime_original/               original .es file and stimuli, for reference
```

## Manual setup (without run.sh)

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/pip install -e ./expfactory_deploy_local
.venv/bin/expfactory_deploy_local -e simple_stopping_fixed_ssds -raw data/raw -sub s03 -ses 1 -gi 3
```

Run the server from the repo root. While it runs, it creates a temporary `static` link in the folder it's started from.

## Credits

- Original E-Prime task: Patrick Bissett.
- `expfactory_deploy_local`: from [lobennett/expfactory-deploy](https://github.com/lobennett/expfactory-deploy) (MIT License, see `expfactory_deploy_local/LICENSE`).
- [jsPsych](https://www.jspsych.org/) 7.3.1 (MIT License).
