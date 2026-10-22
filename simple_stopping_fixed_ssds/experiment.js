// jsPsych 7 translation of the E-Prime task "SimpleStoppingFixedSSDs.es" (Patrick Bissett),
// packaged for expfactory_deploy_local. The deploy template creates `jsPsych`, calls
// simple_stopping_fixed_ssds_init(), then runs simple_stopping_fixed_ssds_experiment and
// POSTs the data to the server when the timeline finishes.
//
// Flow (SessionProc):
//   instructions -> go-only practice (12) -> stop-signal practice (12, SSD 250)
//   -> 5 main blocks of 240 (960 go / 240 stop overall, SSDs 100-500 fixed)
//   -> finish screen (experimenter presses 9)
//
// Trial timing (identical for go and stop trials):
//   fixation "+" 500 ms -> shape 850 ms -> blank ITI 1000 ms
//   response window = 1850 ms from shape onset; first key only; never ends the trial early.
// Stop trials: 500Hz.wav plays SSD ms after shape onset; any key press during the
// trial (fixation, shape or ITI) counts as a failed stop.

const expID = 'simple_stopping_fixed_ssds';
const EXP_PATH = `/static/experiments/${expID}`;

// ---------------------------------------------------------------------------
// Parameters (from the E-Prime file)
// ---------------------------------------------------------------------------
const FIXATION_MS = 500;
const TARGET_MS = 850;
const RESPONSE_WINDOW_MS = 1850; // Target TimeLimit; covers shape + ITI
const GET_READY_MS = 3000;

const GO_PRACTICE_REPS = 3; // PracTrialList: 4 shapes x weight 3 = 12
const SS_PRACTICE_GO = 8; // SSPracTrialChoiceList weights
const SS_PRACTICE_STOP = 4;
const PRACTICE_SSD = 250; // PracToneSetup

const N_MAIN_BLOCKS = 5;
const MAIN_TRIALS_PER_BLOCK = 240;
const MAIN_GO_TOTAL = 960; // TrialChoiceList weights
const MAIN_STOP_TOTAL = 240;
const MAIN_SSDS = [100, 200, 300, 400, 500]; // SSDChoiceList, 48 each

// Stop signal: the original 500Hz.wav (100 ms). The synthesized tone below is only a
// fallback for when the wav can't be fetched.
const STOP_SIGNAL_FILE = `${EXP_PATH}/stimuli/500Hz.wav`;
const FALLBACK_TONE_HZ = 500;
const FALLBACK_TONE_MS = 100;

const SHAPES = ['triangle', 'square', 'circle', 'rhombus'];

// ---------------------------------------------------------------------------
// Response mapping (ResponseSetup inline): counterbalanced by subject number mod 6
// ---------------------------------------------------------------------------
const MAPPINGS = {
  1: { triangle: 'z', circle: 'z', square: 'm', rhombus: 'm' },
  2: { triangle: 'z', circle: 'm', square: 'z', rhombus: 'm' },
  3: { triangle: 'z', circle: 'm', square: 'm', rhombus: 'z' },
  4: { triangle: 'm', circle: 'z', square: 'z', rhombus: 'm' },
  5: { triangle: 'm', circle: 'z', square: 'm', rhombus: 'z' },
  0: { triangle: 'm', circle: 'm', square: 'z', rhombus: 'z' },
};

let subject = null;
let session = null;
let keyMap = null;

function setSubject(subj, sess) {
  subject = parseInt(subj, 10);
  session = sess === null ? null : parseInt(sess, 10) || 1;
  keyMap = MAPPINGS[subject % 6];
  jsPsych.data.addProperties({ subject_number: subject, session_number: session });
}

// ---------------------------------------------------------------------------
// Stimuli
// ---------------------------------------------------------------------------
// Original E-Prime bitmaps (converted losslessly to PNG), shown at native size like
// the E-Prime Image object (Stretch=No).
const imagePath = (shape) => `${EXP_PATH}/stimuli/${shape}.png`;
const shapeHTML = (shape) => `<img class="shape" src="${imagePath(shape)}">`;

const inst = (text) => `<div class="inst">${text.replace(/\n/g, '<br>')}</div>`;

// Stop signal via Web Audio, scheduled on the audio clock for accurate SSDs.
let audioCtx = null;
let stopSignalBuffer = null;

function unlockAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    fetch(STOP_SIGNAL_FILE)
      .then((r) => r.arrayBuffer())
      .then((bytes) => audioCtx.decodeAudioData(bytes))
      .then((buffer) => { stopSignalBuffer = buffer; })
      .catch(() => console.warn(`Could not load ${STOP_SIGNAL_FILE}; using synthesized tone.`));
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}
document.addEventListener('keydown', unlockAudio);
document.addEventListener('mousedown', unlockAudio);

function playToneAfter(delayMs) {
  unlockAudio();
  const start = audioCtx.currentTime + delayMs / 1000;
  if (stopSignalBuffer) {
    const src = audioCtx.createBufferSource();
    src.buffer = stopSignalBuffer;
    src.connect(audioCtx.destination);
    src.start(start);
    return;
  }
  const osc = audioCtx.createOscillator();
  osc.frequency.value = FALLBACK_TONE_HZ;
  osc.connect(audioCtx.destination);
  osc.start(start);
  osc.stop(start + FALLBACK_TONE_MS / 1000);
}

// ---------------------------------------------------------------------------
// Trial lists
// ---------------------------------------------------------------------------
const randomShape = () => jsPsych.randomization.sampleWithReplacement(SHAPES, 1)[0];

// Go practice: each shape 3 times, random order (PracTrialList, Order=random).
function goPracticeTrials() {
  return jsPsych.randomization.repeat(SHAPES, GO_PRACTICE_REPS).map((shape) => ({
    shape, isStop: false, ssd: null,
  }));
}

// Stop practice: 8 go + 4 stop in random order; shapes drawn with replacement.
function stopPracticeTrials() {
  const types = jsPsych.randomization.shuffle([
    ...Array(SS_PRACTICE_GO).fill(false),
    ...Array(SS_PRACTICE_STOP).fill(true),
  ]);
  return types.map((isStop) => ({
    shape: randomShape(), isStop, ssd: isStop ? PRACTICE_SSD : null,
  }));
}

// Main task: TrialChoiceList is not reset between runs, so the 1200-trial pool
// (960 go / 240 stop) is drawn without replacement across the 5 blocks of 240.
// SSDChoiceList likewise deals each SSD exactly 48 times across all stop trials.
function mainBlocks() {
  const types = jsPsych.randomization.shuffle([
    ...Array(MAIN_GO_TOTAL).fill(false),
    ...Array(MAIN_STOP_TOTAL).fill(true),
  ]);
  const ssds = jsPsych.randomization.repeat(MAIN_SSDS, MAIN_STOP_TOTAL / MAIN_SSDS.length);
  const trials = types.map((isStop) => ({
    shape: randomShape(), isStop, ssd: isStop ? ssds.pop() : null,
  }));
  const blocks = [];
  for (let b = 0; b < N_MAIN_BLOCKS; b++) {
    blocks.push(trials.slice(b * MAIN_TRIALS_PER_BLOCK, (b + 1) * MAIN_TRIALS_PER_BLOCK));
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Trial procedure (Fixation -> Target -> ITI)
// ---------------------------------------------------------------------------
function makeTrial(spec, blockName, trialNum) {
  let fixationResponse = null;

  const fixation = {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: '<div class="fixation">+</div>',
    choices: 'ALL_KEYS',
    trial_duration: FIXATION_MS,
    response_ends_trial: false,
    data: { trial_id: 'fixation', block: blockName, exp_id: expID },
    on_finish: (data) => { fixationResponse = data.response; },
  };

  const target = {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: () => shapeHTML(spec.shape),
    choices: 'ALL_KEYS',
    stimulus_duration: TARGET_MS, // shape disappears; remaining 1000 ms is the blank ITI
    trial_duration: RESPONSE_WINDOW_MS,
    response_ends_trial: false,
    data: () => ({
      trial_id: 'target',
      exp_id: expID,
      block: blockName,
      trial_num: trialNum,
      condition: spec.isStop ? 'stop' : 'go',
      shape: spec.shape,
      correct_response: spec.isStop ? null : keyMap[spec.shape],
      SSD: spec.ssd,
    }),
    on_load: () => {
      if (spec.isStop) playToneAfter(spec.ssd);
    },
    on_finish: (data) => {
      if (spec.isStop) {
        // SSChange / PracSSFeedInput: success only if no key at any point in the trial
        data.fixation_response = fixationResponse;
        data.stop_success = data.response === null && fixationResponse === null ? 1 : 0;
        data.acc = data.stop_success;
      } else {
        data.acc = data.response === data.correct_response ? 1 : 0;
      }
    },
  };

  return { timeline: [fixation, target] };
}

function makeBlock(specs, blockName) {
  return { timeline: specs.map((spec, i) => makeTrial(spec, blockName, i + 1)) };
}

// ---------------------------------------------------------------------------
// Feedback helpers
// ---------------------------------------------------------------------------
const blockTrials = (blockName) =>
  jsPsych.data.get().filter({ trial_id: 'target', block: blockName });

// Mean RT over go trials with a response. (E-Prime divided the RT sum by all go
// trials, so misses counted as RT=0 and pulled the average down.)
function meanGoRT(blockName) {
  const rts = blockTrials(blockName).filter({ condition: 'go' }).filterCustom((t) => t.rt !== null);
  return rts.count() > 0 ? Math.round(rts.select('rt').mean()) : '--';
}

const correctCount = (blockName) => blockTrials(blockName).filter({ acc: 1 }).count();

function goAccuracyPercent(blockName) {
  const go = blockTrials(blockName).filter({ condition: 'go' });
  return go.count() > 0 ? Math.round((go.filter({ acc: 1 }).count() / go.count()) * 100) : 0;
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------
const keyScreen = (html, trialId) => ({
  type: jsPsychHtmlKeyboardResponse,
  stimulus: html,
  choices: 'ALL_KEYS',
  data: { trial_id: trialId, exp_id: expID },
});

const responseMapping = {
  type: jsPsychHtmlKeyboardResponse,
  stimulus: () => `<div class="inst">
    <p>If the shape is a triangle, press:</p><p>${keyMap.triangle.toUpperCase()}</p>
    <p>If the shape is a circle, press:</p><p>${keyMap.circle.toUpperCase()}</p>
    <p>If the shape is a square, press:</p><p>${keyMap.square.toUpperCase()}</p>
    <p>If the shape is a rhombus (diamond), press:</p><p>${keyMap.rhombus.toUpperCase()}</p>
  </div>`,
  choices: 'ALL_KEYS',
  data: { trial_id: 'response_mapping', exp_id: expID },
};

const practiceFeedback = (blockName) => ({
  type: jsPsychHtmlKeyboardResponse,
  stimulus: () => `<div class="inst feedback">
    <p>Your average reaction time in milliseconds was:</p><p>${meanGoRT(blockName)}</p>
    <p>Your total number of correct answers out of 12 was:</p><p>${correctCount(blockName)}</p>
    <p>(Press any key to Continue)</p>
  </div>`,
  choices: 'ALL_KEYS',
  data: { trial_id: 'practice_feedback', block: blockName, exp_id: expID },
});

const mainFeedback = (blockName) => ({
  type: jsPsychHtmlKeyboardResponse,
  stimulus: () => `<div class="inst feedback">
    <p>Please Take a Moment to Rest</p>
    <p>Your average reaction time on non-beep trials in milliseconds was:</p><p>${meanGoRT(blockName)}</p>
    <p>Your percent accuracy on non-beep trials was approximately:</p><p>${goAccuracyPercent(blockName)}</p>
    <p>Press any key when ready for the next block</p>
  </div>`,
  choices: 'ALL_KEYS',
  data: { trial_id: 'main_feedback', block: blockName, exp_id: expID },
});

const getReady = {
  type: jsPsychHtmlKeyboardResponse,
  stimulus: '<div class="red-screen">GET READY!!</div>',
  choices: 'NO_KEYS',
  trial_duration: GET_READY_MS,
  data: { trial_id: 'get_ready', exp_id: expID },
};

const getReadyForReal = keyScreen(
  '<div class="red-screen"><div class="inst">You Are Done With Practice Trials<br><br>' +
    'Please contact the experimenter at this time if you have an questions<br><br>' +
    '(press any key to start the main task)</div></div>',
  'get_ready_for_real'
);

// ---------------------------------------------------------------------------
// Startup info (Subject / Session).
// The numeric subject number sets the key mapping. It comes from, in order:
//   expfactory_deploy_local -gi <number>  (window.efVars.group_index)
//   ?subject=<number>&session=<number> in the URL
//   a form at the start of the task
// ---------------------------------------------------------------------------
const startupInfo = {
  timeline: [{
    type: jsPsychSurveyText,
    questions: [
      { prompt: 'Please enter the Subject Number (1-32767):', name: 'subject', required: true },
      { prompt: 'Please enter the Session Number (1-32767):', name: 'session', required: true },
    ],
    data: { trial_id: 'startup_info', exp_id: expID },
    on_finish: (data) => setSubject(data.response.subject, data.response.session),
  }],
  conditional_function: () => {
    const groupIndex = window.efVars && window.efVars.group_index;
    if (groupIndex !== undefined && groupIndex !== null) {
      setSubject(groupIndex, null);
      return false;
    }
    const urlSubject = jsPsych.data.getURLVariable('subject');
    if (urlSubject !== undefined) {
      setSubject(urlSubject, jsPsych.data.getURLVariable('session') || null);
      return false;
    }
    return true;
  },
};

// Fullscreen (E-Prime ran full screen); the button click also unlocks Web Audio.
const fullscreen = {
  type: jsPsychFullscreen,
  fullscreen_mode: true,
  data: { trial_id: 'fullscreen', exp_id: expID },
};

const exitFullscreen = {
  type: jsPsychFullscreen,
  fullscreen_mode: false,
  data: { trial_id: 'exit_fullscreen', exp_id: expID },
};

// ---------------------------------------------------------------------------
// Session procedure
// ---------------------------------------------------------------------------
var simple_stopping_fixed_ssds_experiment = [];
var simple_stopping_fixed_ssds_init = () => {
  const timeline = simple_stopping_fixed_ssds_experiment;

  timeline.push(
    { type: jsPsychPreload, images: SHAPES.map(imagePath), data: { trial_id: 'preload', exp_id: expID } },
    fullscreen,
    startupInfo
  );

  // Instructions
  timeline.push(
    keyScreen(inst('Welcome to the Experiment!\n\n(Press any key to continue)'), 'inst1'),
    keyScreen(inst('There will be many trials in succession.\n\nEach trial will begin with a small black cross in the middle of the screen. \n\nThe screen will look like this:\n\n(Press any key to continue)'), 'inst2'),
    keyScreen(inst('+\n\n(Press any key to continue)'), 'inst3'),
    keyScreen(inst('Then there will be a display of a single shape. The screen will look like this:\n\n(press any key to continue)'), 'inst4'),
    keyScreen(shapeHTML('triangle'), 'instrucs_triangle'),
    responseMapping,
    keyScreen(inst('You want to respond as quickly and accurately as you can to the shape.\n\nYou can now practice this part of the task. \n\n(press any key to start the practice)'), 'inst5')
  );

  // GoPracticeRunProc
  timeline.push(
    makeBlock(goPracticeTrials(), 'go_practice'),
    practiceFeedback('go_practice'),
    keyScreen(inst('You have completed the first section of practice. \n\n(press any key to continue)'), 'transition_to_ss_practice')
  );

  // StopSignalPracticeRunProc
  timeline.push(
    keyScreen(inst('Some trials you will hear an auditory beep come from the headphones around the time that you will be responding. If you hear a beep, you do not want to respond on the trial. It does not matter what shape was presented on that trial.  You should attempt to refrain from pressing any key on that trial.\n\n(press any key to continue)'), 'inst6'),
    keyScreen(inst('Refraining from response can be very difficult, as the beep will come at the approximate time you will be responding. Sometimes you will be able to stop your response, and sometimes you will not be able to stop your response. Do not slow your responses in order to wait for beeps to occur. Continue to answer as quickly as possible to shapes. When beeps do occur, do your best at that point to refrain from response, realizing you will not be able to stop your response every time.\n\n(press any key to continue)'), 'inst7'),
    keyScreen(inst('After each block of trials, you will see your accuracy and average reaction time for non-stop trials. Write these values down on the provided sheet. Speed and accuracy, as well as stopping to the beep, are all important for this task.\n\n(press any key to review your response keys)'), 'inst8'),
    responseMapping,
    keyScreen(inst('In review:\n\nA black fixation cross indicates the beginning of trial.\n\nPress the key that corresponds to the presented shape.\n\nIf the computer emits a beep, then attempt to refrain from response for that trial.\n\n(Press any key to continue)'), 'inst9'),
    keyScreen(inst('The instructions are now complete. Ask the experimenter at this time if you have any questions. \n\n(Press any key to begin the practice)'), 'inst10'),
    makeBlock(stopPracticeTrials(), 'stop_practice'),
    practiceFeedback('stop_practice'),
    getReadyForReal
  );

  // MainTaskProc x 5
  mainBlocks().forEach((specs, b) => {
    const name = `main_${b + 1}`;
    timeline.push(makeBlock(specs, name), mainFeedback(name), getReady);
  });

  // TaskFinishProc (only the experimenter's "9" key advances)
  timeline.push(
    {
      type: jsPsychHtmlKeyboardResponse,
      stimulus: inst('Thank you for completing the task. Please contact the experimenter now.'),
      choices: ['9'],
      data: { trial_id: 'end', exp_id: expID },
    },
    exitFullscreen
  );
};
