const STRICT_INPUT_MODE = true;
const IGNORE_LATE_ANSWERS = true;
const INPUT_BLOCK_DURATION = 500;
let minimumISI = 2000;

let previousRoundAnswer = null;
let lastRoundChangeTime = 0;
let inputBlockedUntil = 0;

let howlReady = false;
let numberSounds = {};
let audioInitialized = false;
let beepSound = null;

let lastPresentedNumber = null;
let currentNumber = null;
let correctAnswer = null;
let currentIntervalId = null;
let audioPlayInProgress = false;
let processingAnswer = false;
let nextPresentationTime = 0;
let forcePresentNextNumber = false;
let useNumberPad = false;
let answerProcessed = false;

let nbackValue = 1;
let numberSequence = [];
let currentTrialId = 0;
let nextNumberScheduled = false;

let trainingTimerId = null;
let currentISIValue = 3000;
let consecutiveCorrect = 0;
let consecutiveIncorrect = 0;
let sessionHistory = [];
let totalCorrect = 0;
let totalAttempts = 0;
let lowestISI = 3000;
let remainingTime = 1200;
let sessionActive = false;

let feedbackSettings = { enabled: true, duration: 1000 };
let beepSettings = { enabled: false, volume: 0.5 };
let audioSpeedSettings = { rate: 1.0 };
let nbackSettings = { value: 1 };

let isStandardMode = false;
let isCustomMode = true;
let isManualMode = false;

let standardModeSettings = { selectedISI: 3000, sessionDuration: 20 };
let manualModeSettings = { selectedISI: 5000, sessionDuration: 20 };
let customModeSettings = { selectedISI: 3000, sessionDuration: 20 };

let selectedISI = 3000;
let sessionDuration = 20;

let descriptionScreen, trainingScreen, resultsScreen;
let startTraining, endTraining, startNewTraining;
let customMode, manualMode;
let statusMessage, answerInput, currentISI, timerCircle, minutesLeft, secondsLeft;
let correctCount, totalCount, accuracyRate, minISI, historyContainer;
let useNumberPadToggle, numberpad, numberpadButtons;

let allSessions = [];

function initializeHowlerAudio() {
  const numberFiles = {
    1: 'audio/one.wav', 2: 'audio/two.wav', 3: 'audio/three.wav',
    4: 'audio/four.wav', 5: 'audio/five.wav', 6: 'audio/six.wav',
    7: 'audio/seven.wav', 8: 'audio/eight.wav', 9: 'audio/nine.wav'
  };
  
  let loadedCount = 0;
  const totalSounds = 9;
  
  for (let i = 1; i <= 9; i++) {
    numberSounds[i] = new Howl({
      src: [numberFiles[i]],
      preload: true,
      html5: false,
      onload: () => { if (++loadedCount === totalSounds) howlReady = true; },
      onloaderror: (id, err) => console.error(`Error loading ${i}:`, err)
    });
    numberSounds[i].load();
  }
}

function playNumberWithHowler(number) {
  return new Promise((resolve) => {
    if (audioPlayInProgress || !howlReady || !numberSounds[number]) {
      resolve();
      return;
    }
    
    audioPlayInProgress = true;
    numberSounds[number].volume(1.0);
    numberSounds[number].rate(audioSpeedSettings.rate);
    
    let hasResolved = false;
    const baseAudioDuration = 500;
    const dynamicAudioWindow = Math.ceil(baseAudioDuration / audioSpeedSettings.rate);
    const safetyTimeout = setTimeout(() => resolveOnce(), dynamicAudioWindow + 100);
    
    function resolveOnce() {
      if (!hasResolved) {
        hasResolved = true;
        audioPlayInProgress = false;
        clearTimeout(safetyTimeout);
        resolve();
      }
    }
    
    numberSounds[number].once('end', resolveOnce);
    
    try {
      const soundId = numberSounds[number].play();
      if (soundId === null) {
        clearTimeout(safetyTimeout);
        resolveOnce();
      }
    } catch (e) {
      clearTimeout(safetyTimeout);
      resolveOnce();
    }
  });
}

function speakNumber(number) {
  if (!sessionActive) return Promise.resolve();
  return playNumberWithHowler(number);
}

function stopAllAudio() {
  Object.values(numberSounds).forEach(sound => {
    if (sound.playing()) sound.stop();
  });
  if (beepSound && beepSound.playing()) beepSound.stop();
  if (window.speechSynthesis && window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
  }
  audioPlayInProgress = false;
}

function initializeBeepAudio() {
  beepSound = new Howl({
    src: ['audio/beep.wav'],
    preload: true,
    html5: true,
    volume: beepSettings.volume
  });
}

function playErrorBeep() {
  if (!beepSettings.enabled || beepSettings.volume <= 0) return;
  
  setTimeout(() => {
    try {
      if (beepSound && beepSound.state() === 'loaded') {
        beepSound.volume(beepSettings.volume);
        beepSound.play();
      } else {
        const beepAudio = new Audio('audio/beep.wav');
        beepAudio.volume = beepSettings.volume;
        beepAudio.play().catch(err => console.error('Beep error:', err));
        beepAudio.onended = () => beepAudio.remove();
        setTimeout(() => { if (beepAudio.src) beepAudio.remove(); }, 200);
      }
    } catch (error) {
      console.error('Beep error:', error);
    }
  }, 0);
}

function canProcessButtonClick() {
  return !processingAnswer && correctAnswer !== null && !audioPlayInProgress && !answerProcessed;
}

function canProcessAnswerImmediately(userAnswer) {
  return canProcessButtonClick() && userAnswer === correctAnswer;
}

function shouldProcessAnswerImmediately(userAnswer) {
  return canProcessAnswerImmediately(userAnswer);
}

function updateConsecutiveCounter() {
  const dots = document.querySelectorAll('.counter-dot');
  dots.forEach(dot => {
    dot.classList.remove('correct', 'incorrect');
  });
  
  if (consecutiveCorrect > 0) {
    for (let i = 0; i < Math.min(consecutiveCorrect, 4); i++) {
      dots[i].classList.add('correct');
    }
  } else if (consecutiveIncorrect > 0) {
    for (let i = 0; i < Math.min(consecutiveIncorrect, 4); i++) {
      dots[i].classList.add('incorrect');
    }
  }
}

function generateNumber() {
  const ALLOW_AA_PROBABILITY = 0.05;
  const ALLOW_ABA_PROBABILITY = 0.10;
  
  let candidate;
  let attempts = 0;
  const maxAttempts = 20;

  while (attempts < maxAttempts) {
    candidate = Math.floor(Math.random() * 9) + 1;
    let reject = false;
    const len = numberSequence.length;

    if (len > 0 && candidate === numberSequence[len - 1]) {
      if (Math.random() > ALLOW_AA_PROBABILITY) reject = true;
    }

    if (!reject && len > 1 && candidate === numberSequence[len - 2]) {
      if (Math.random() > ALLOW_ABA_PROBABILITY) reject = true;
    }

    if (!reject) return candidate;
    attempts++;
  }

  return candidate;
}

function calculateNbackAnswer(currentNum, sequence, nback) {
  if (sequence.length < nback) return null;
  return currentNum + sequence[sequence.length - nback - 1];
}

function startSession() {
  if (!audioInitialized) audioInitialized = true;
  stopAllAudio();
  
  if (useNumberPad) {
    answerInput.style.display = 'none';
    numberpad.style.display = 'grid';
    numberpadButtons.forEach(btn => {
      btn.classList.remove('selected', 'incorrect-selection');
    });
    updateNumberpadSize();
  } else {
    answerInput.style.display = 'block';
    numberpad.style.display = 'none';
    answerInput.value = '';
    answerInput.style.borderColor = '';
    answerInput.focus();
  }
  
  descriptionScreen.style.display = 'none';
  trainingScreen.style.display = 'block';
  resultsScreen.style.display = 'none';
  
  selectedISI = Math.max(1200, selectedISI);
  currentISIValue = selectedISI;
  currentISI.textContent = currentISIValue;
  consecutiveCorrect = 0;
  consecutiveIncorrect = 0;
  remainingTime = sessionDuration * 60;
  sessionHistory = [];
  totalCorrect = 0;
  totalAttempts = 0;
  
  const nbackInput = document.getElementById('nbackValue');
  if (nbackInput) {
    nbackValue = Math.max(1, Math.min(10, parseInt(nbackInput.value) || 1));
    nbackInput.value = nbackValue;
  }
  
  numberSequence = [];
  lowestISI = isManualMode ? currentISIValue : currentISIValue;
  currentNumber = null;
  correctAnswer = null;
  lastPresentedNumber = null;
  processingAnswer = false;
  nextPresentationTime = 0;
  forcePresentNextNumber = false;
  answerProcessed = false;
  currentTrialId = 0;
  nextNumberScheduled = false;
  audioPlayInProgress = false;
  
  if (currentIntervalId) {
    clearTimeout(currentIntervalId);
    currentIntervalId = null;
  }
  
  numberpadButtons.forEach(btn => {
    btn.classList.remove('selected', 'incorrect-selection');
  });
  updateConsecutiveCounter();
  updateTimerDisplay();
  
  statusMessage.textContent = "";
  statusMessage.style.color = '';
  answerInput.value = '';
  answerInput.style.borderColor = '';
  answerInput.focus();
  
  trainingTimerId = setInterval(updateTimer, 1000);
  sessionActive = true;
  
  setTimeout(() => presentNextNumber(), 1000);
}

async function presentNextNumber() {
  if (correctAnswer !== null) {
    previousRoundAnswer = correctAnswer;
    lastRoundChangeTime = Date.now();
    inputBlockedUntil = Date.now() + INPUT_BLOCK_DURATION;
  }

  if (!sessionActive || nextNumberScheduled) return;
  nextNumberScheduled = true;
  
  if (currentIntervalId) {
    clearTimeout(currentIntervalId);
    currentIntervalId = null;
  }

  const currentTime = Date.now();
  
  if (numberSequence.length > 0 && !forcePresentNextNumber) {
    const timeUntilNextPresentation = nextPresentationTime - currentTime;
    if (timeUntilNextPresentation > 0) {
      currentIntervalId = setTimeout(() => presentNextNumber(), timeUntilNextPresentation);
      return;
    }
  }
  
  forcePresentNextNumber = false;

  if (useNumberPad) {
    numberpadButtons.forEach(btn => {
      btn.classList.remove('selected', 'incorrect-selection');
    });
  } else {
    answerInput.value = '';
    answerInput.focus();
  }

  statusMessage.textContent = "";
  statusMessage.style.color = '';
  answerInput.style.borderColor = '';

  currentNumber = generateNumber();
  numberSequence.push(currentNumber);
  
  if (numberSequence.length >= nbackValue + 1) {
    correctAnswer = calculateNbackAnswer(currentNumber, numberSequence, nbackValue);
    currentTrialId++;

    sessionHistory.push({
      nbackValue: nbackValue,
      currentNumber: currentNumber,
      previousNumber: numberSequence[numberSequence.length - nbackValue - 1],
      correctAnswer: correctAnswer,
      userAnswer: null,
      correct: null,
      isi: currentISIValue,
      trialId: currentTrialId
    });
  }
  
  lastPresentedNumber = currentNumber;
  nextNumberScheduled = false;
  
  if (correctAnswer !== null) {
    answerProcessed = false;
    processingAnswer = false;
  }
  
  if (!useNumberPad) {
    answerInput.value = '';
    answerInput.focus();
  }
  
  try {
    await speakNumber(currentNumber);
    
    if (numberSequence.length >= nbackValue + 1) {
      nextPresentationTime = Date.now() + currentISIValue;
      currentIntervalId = setTimeout(() => presentNextNumber(), currentISIValue);
      
      const trialId = currentTrialId;
      const trialPresentationTime = Date.now();
      
      setTimeout(() => {
        if (!answerProcessed && !processingAnswer) {
          const targetTrial = sessionHistory.find(t => t.trialId === trialId);
          if (!targetTrial || targetTrial.userAnswer !== null) return;
          
          const lastTrialIndex = sessionHistory.length - 1;
          const targetTrialIndex = sessionHistory.findIndex(t => t.trialId === trialId);
          
          if (targetTrialIndex !== lastTrialIndex) {
            const responseTime = Date.now() - trialPresentationTime;
            targetTrial.responseTime = responseTime;
            targetTrial.userAnswer = null;
            targetTrial.correct = false;
            
            totalAttempts++;
            consecutiveCorrect = 0;
            consecutiveIncorrect++;
            
            if (!isManualMode && consecutiveIncorrect >= 4) {
              currentISIValue = Math.min(5000, currentISIValue + 100);
              currentISI.textContent = currentISIValue;
              consecutiveIncorrect = 0;
            }
            
            updateConsecutiveCounter();
            playErrorBeep();
          } else {
            let finalAnswer = null;
            
            if (useNumberPad) {
              const selectedButton = document.querySelector('.numberpad-button.selected');
              if (selectedButton) finalAnswer = parseInt(selectedButton.getAttribute('data-value'));
            } else {
              const inputValue = answerInput.value.trim();
              if (inputValue) finalAnswer = Number(inputValue);
            }
            
            let userAnswer = null;
            if (finalAnswer !== null && !isNaN(finalAnswer)) {
              userAnswer = Number(finalAnswer);
            }
            
            answerProcessed = true;
            let success = userAnswer !== null ? processAnswer(userAnswer) : processAnswer(null);
            
            if (!success) answerProcessed = false;
            
            if (useNumberPad) {
              numberpadButtons.forEach(btn => btn.classList.remove('selected'));
            } else {
              answerInput.value = '';
              answerInput.focus();
            }
          }
        }
      }, currentISIValue);
    } else {
      nextPresentationTime = Date.now() + currentISIValue;
      currentIntervalId = setTimeout(() => presentNextNumber(), currentISIValue);
    }
  } catch (error) {
    nextNumberScheduled = false;
    setTimeout(() => {
      if (!nextNumberScheduled && !processingAnswer) presentNextNumber();
    }, 1000);
  }
}

function processAnswer(userAnswer) {
  if (processingAnswer || correctAnswer === null) return false;
  processingAnswer = true;

  const currentTrial = sessionHistory[sessionHistory.length - 1];
  if (!currentTrial || currentTrial.userAnswer !== null || currentTrial.correctAnswer !== correctAnswer) {
    processingAnswer = false;
    return false;
  }

  const responseTime = Date.now() - (nextPresentationTime - currentISIValue);
  currentTrial.responseTime = responseTime;
  currentTrial.userAnswer = userAnswer;
  
  let isCorrect = false;
  if (userAnswer !== null && userAnswer !== undefined) {
    const numericAnswer = Number(userAnswer);
    const numericCorrect = Number(currentTrial.correctAnswer);
    isCorrect = !isNaN(numericAnswer) && !isNaN(numericCorrect) && numericAnswer === numericCorrect;
  }
  currentTrial.correct = isCorrect;

  totalAttempts++;
  if (isCorrect) {
    totalCorrect++;
    consecutiveCorrect++;
    consecutiveIncorrect = 0;
  } else {
    consecutiveCorrect = 0;
    consecutiveIncorrect++;
  }

  if (feedbackSettings.enabled) {
    const feedbackColor = isCorrect ? 'var(--success)' : 'var(--danger)';
    const feedbackText = isCorrect ? 'Correct!' : 'Incorrect';
    
    if (useNumberPad) {
      statusMessage.textContent = feedbackText;
      statusMessage.style.color = feedbackColor;
    } else {
      answerInput.style.borderColor = feedbackColor;
      statusMessage.textContent = feedbackText;
      statusMessage.style.color = feedbackColor;
    }
    
    setTimeout(() => {
      if (sessionActive) {
        statusMessage.textContent = "";
        answerInput.style.borderColor = "";
      }
    }, feedbackSettings.duration);
  }

  if (!isManualMode) {
    const minISI = Math.max(500, minimumISI);
    
    if (consecutiveCorrect >= 4) {
      currentISIValue = Math.max(minISI, currentISIValue - 100);
      currentISI.textContent = currentISIValue;
      lowestISI = Math.min(lowestISI, currentISIValue);
      consecutiveCorrect = 0;
    } else if (consecutiveIncorrect >= 4) {
      currentISIValue = Math.min(5000, currentISIValue + 100);
      currentISI.textContent = currentISIValue;
      consecutiveIncorrect = 0;
    }
  } else {
    currentISIValue = selectedISI;
    currentISI.textContent = currentISIValue;
  }
  
  updateConsecutiveCounter();
  
  if (useNumberPad) {
    if (isCorrect) numberpadButtons.forEach(btn => btn.classList.remove('selected'));
  } else {
    if (isCorrect) answerInput.value = '';
    else answerInput.focus();
  }
  
  if (!isCorrect) playErrorBeep();
  
  processingAnswer = false;
  return true;
}

function updateTimer() {
  remainingTime--;
  updateTimerDisplay();
  if (remainingTime <= 0) endSession();
}

function updateTimerDisplay() {
  const minutes = Math.floor(remainingTime / 60);
  const seconds = remainingTime % 60;
  
  minutesLeft.textContent = minutes.toString().padStart(2, '0');
  secondsLeft.textContent = seconds.toString().padStart(2, '0');
  
  const progress = (sessionDuration * 60 - remainingTime) / (sessionDuration * 60) * 100;
  timerCircle.style.background = `conic-gradient(var(--primary) 0% ${progress}%, var(--border-light) ${progress}% 100%)`;
}

function endSession() {
  stopAllAudio();
  clearInterval(trainingTimerId);
  
  if (currentIntervalId) {
    clearTimeout(currentIntervalId);
    currentIntervalId = null;
  }
  
  sessionActive = false;
  processingAnswer = false;
  answerProcessed = false;
  nextNumberScheduled = false;
  audioPlayInProgress = false;
  forcePresentNextNumber = false;
  
  trainingScreen.style.display = 'none';
  resultsScreen.style.display = 'block';
  
  correctCount.textContent = totalCorrect;
  totalCount.textContent = totalAttempts;
  const accuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;
  accuracyRate.textContent = `${accuracy}%`;
  minISI.textContent = lowestISI;
  
  addSessionToHistory();
  updateCumulativeStats();
}

function updateNumberpadSize() {
  const size = getComputedStyle(document.documentElement).getPropertyValue('--numberpad-button-size');
  const scale = parseFloat(size) || 1;
  
  numberpadButtons.forEach(btn => {
    btn.style.transform = `scale(${scale})`;
  });
  
  const numberpad = document.getElementById('numberpad');
  if (numberpad) {
    const baseGap = 6;
    const buttonSize = 56;
    const scaledButtonSize = buttonSize * scale;
    const gapPercentage = scale > 1.5 ? 0.6 : scale > 1.0 ? 0.45 : 0.3;
    const minGap = Math.max(baseGap, Math.round(scaledButtonSize * gapPercentage));
    numberpad.style.gap = `${minGap}px`;
    
    const basePadding = 16;
    const paddingMultiplier = scale > 1.5 ? 2.0 : scale > 1.0 ? 1.5 : 1.2;
    const containerPadding = Math.max(basePadding, Math.round(basePadding * paddingMultiplier));
    numberpad.style.padding = `${containerPadding}px`;
  }
}

function loadSessions() {
  try {
    const saved = localStorage.getItem('pasatSessions');
    if (saved) allSessions = JSON.parse(saved);
  } catch (error) {
    console.error('Error loading sessions:', error);
    allSessions = [];
  }
}

function saveSessions() {
  try {
    localStorage.setItem('pasatSessions', JSON.stringify(allSessions));
  } catch (error) {
    console.error('Error saving sessions:', error);
  }
}

function loadCustomModeSettings() {
  try {
    const saved = localStorage.getItem('pasatCustomModeSettings');
    if (saved) {
      const settings = JSON.parse(saved);
      customModeSettings.selectedISI = settings.selectedISI || 3000;
      customModeSettings.sessionDuration = settings.sessionDuration || 20;
      updateCustomModeUI();
    }
  } catch (error) {
    console.error('Error loading custom mode settings:', error);
  }
}

function loadManualModeSettings() {
  try {
    const saved = localStorage.getItem('pasatManualModeSettings');
    if (saved) {
      const settings = JSON.parse(saved);
      manualModeSettings.selectedISI = settings.selectedISI || 5000;
      manualModeSettings.sessionDuration = settings.sessionDuration || 20;
    }
  } catch (error) {
    console.error('Error loading manual mode settings:', error);
  }
}

function loadNbackSettings() {
  try {
    const saved = localStorage.getItem('pasatNbackSettings');
    if (saved) {
      const settings = JSON.parse(saved);
      nbackSettings.value = Math.max(1, Math.min(10, settings.value || 1));
    }
  } catch (error) {
    console.error('Error loading N-back settings:', error);
  }
}

function loadBeepSettings() {
  try {
    const saved = localStorage.getItem('pasatBeepSettings');
    if (saved) {
      const settings = JSON.parse(saved);
      beepSettings.enabled = settings.enabled || false;
      beepSettings.volume = Math.max(0, Math.min(1, settings.volume || 0.5));
      updateBeepUI();
      if (beepSound) beepSound.volume(beepSettings.volume);
    }
  } catch (error) {
    console.error('Error loading beep settings:', error);
  }
}

function loadAudioSpeedSettings() {
  try {
    const saved = localStorage.getItem('pasatAudioSpeedSettings');
    if (saved) {
      const settings = JSON.parse(saved);
      audioSpeedSettings.rate = Math.max(1.0, Math.min(1.5, settings.rate || 1.0));
      updateAudioSpeedUI();
    }
  } catch (error) {
    console.error('Error loading audio speed settings:', error);
  }
}

function loadFeedbackSettings() {
  try {
    const saved = localStorage.getItem('pasatFeedbackSettings');
    if (saved) {
      const settings = JSON.parse(saved);
      feedbackSettings.enabled = settings.enabled !== undefined ? settings.enabled : true;
      feedbackSettings.duration = settings.duration || 1000;
      updateFeedbackUI();
    }
  } catch (error) {
    console.error('Error loading feedback settings:', error);
  }
}

function saveNbackSettings() {
  try {
    localStorage.setItem('pasatNbackSettings', JSON.stringify(nbackSettings));
  } catch (error) {
    console.error('Error saving N-back settings:', error);
  }
}

function saveCustomModeSettings() {
  try {
    localStorage.setItem('pasatCustomModeSettings', JSON.stringify(customModeSettings));
  } catch (error) {
    console.error('Error saving custom mode settings:', error);
  }
}

function saveBeepSettings() {
  try {
    localStorage.setItem('pasatBeepSettings', JSON.stringify(beepSettings));
  } catch (error) {
    console.error('Error saving beep settings:', error);
  }
}

function saveAudioSpeedSettings() {
  try {
    localStorage.setItem('pasatAudioSpeedSettings', JSON.stringify(audioSpeedSettings));
  } catch (error) {
    console.error('Error saving audio speed settings:', error);
  }
}

function saveFeedbackSettings() {
  try {
    localStorage.setItem('pasatFeedbackSettings', JSON.stringify(feedbackSettings));
  } catch (error) {
    console.error('Error saving feedback settings:', error);
  }
}

function loadThemePreference() {
  try {
    const savedTheme = localStorage.getItem('pasatTheme');
    if (savedTheme === 'alternative') {
      document.documentElement.setAttribute('data-theme', 'alternative');
      updateThemeToggleIcon('alternative');
    } else if (savedTheme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      updateThemeToggleIcon('dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      updateThemeToggleIcon('default');
    }
  } catch (error) {
    console.error('Error loading theme preference:', error);
  }
}

function saveThemePreference(theme) {
  try {
    localStorage.setItem('pasatTheme', theme);
  } catch (error) {
    console.error('Error saving theme preference:', error);
  }
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  let newTheme;
  
  if (!currentTheme || currentTheme === 'default') {
    newTheme = 'alternative';
    document.documentElement.setAttribute('data-theme', 'alternative');
  } else if (currentTheme === 'alternative') {
    newTheme = 'dark';
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    newTheme = 'default';
    document.documentElement.removeAttribute('data-theme');
  }
  
  updateThemeToggleIcon(newTheme);
  saveThemePreference(newTheme);
}

function updateThemeToggleIcon(theme) {
  const themeToggle = document.getElementById('themeToggle');
  if (!themeToggle) return;
  
  const themeIcon = themeToggle.querySelector('.theme-icon');
  if (!themeIcon) return;
  
  if (theme === 'alternative') {
    themeIcon.innerHTML = `<circle cx="12" cy="12" r="5"/><path d="M12 1v2"/><path d="M12 21v2"/><path d="M4.22 4.22l1.42 1.42"/><path d="M18.36 18.36l1.42 1.42"/><path d="M1 12h2"/><path d="M21 12h2"/><path d="M4.22 19.78l1.42-1.42"/><path d="M18.36 5.64l1.42-1.42"/>`;
  } else if (theme === 'dark') {
    themeIcon.innerHTML = `<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/><path d="M19 3v4"/><path d="M21 5h-4"/>`;
  } else {
    themeIcon.innerHTML = `<circle cx="12" cy="12" r="5"/><path d="M12 1v2"/><path d="M12 21v2"/><path d="M4.22 4.22l1.42 1.42"/><path d="M18.36 18.36l1.42 1.42"/><path d="M1 12h2"/><path d="M21 12h2"/><path d="M4.22 19.78l1.42-1.42"/><path d="M18.36 5.64l1.42-1.42"/>`;
  }
}

function updateCustomModeUI() {
  selectedISI = customModeSettings.selectedISI;
  sessionDuration = customModeSettings.sessionDuration;
  
  const durationSelect = document.getElementById('durationSelect');
  const startingIntervalSelect = document.getElementById('startingIntervalSelect');
  if (durationSelect) durationSelect.value = sessionDuration;
  if (startingIntervalSelect) startingIntervalSelect.value = selectedISI;
}

function updateManualModeUI() {
  selectedISI = manualModeSettings.selectedISI;
  sessionDuration = manualModeSettings.sessionDuration;
  
  const intervalInput = document.getElementById('intervalInput');
  const durationSelect = document.getElementById('durationSelect');
  if (intervalInput) intervalInput.value = (selectedISI / 1000).toFixed(1);
  if (durationSelect) durationSelect.value = sessionDuration;
}

function updateBeepUI() {
  const useErrorBeep = document.getElementById('useErrorBeep');
  const beepVolumeControls = document.getElementById('beepVolumeControls');
  const beepVolumeSlider = document.getElementById('beepVolumeSlider');
  const beepVolumeValue = document.getElementById('beepVolumeValue');
  
  if (useErrorBeep) {
    useErrorBeep.checked = beepSettings.enabled;
    if (beepVolumeControls) beepVolumeControls.style.display = beepSettings.enabled ? 'block' : 'none';
  }
  
  if (beepVolumeSlider && beepVolumeValue) {
    beepVolumeSlider.value = beepSettings.volume;
    if (beepSettings.volume <= 0.3) {
      beepVolumeValue.textContent = 'Quiet';
    } else if (beepSettings.volume <= 0.7) {
      beepVolumeValue.textContent = 'Medium';
    } else {
      beepVolumeValue.textContent = 'Loud';
    }
  }
  
  if (beepSound) beepSound.volume(beepSettings.volume);
}

function updateAudioSpeedUI() {
  const audioSpeedSlider = document.getElementById('audioSpeedSlider');
  const audioSpeedValue = document.getElementById('audioSpeedValue');
  
  if (audioSpeedSlider && audioSpeedValue) {
    audioSpeedSlider.value = audioSpeedSettings.rate;
    if (audioSpeedSettings.rate === 1.0) {
      audioSpeedValue.textContent = 'Normal (1.0x)';
    } else {
      audioSpeedValue.textContent = `Fast (${audioSpeedSettings.rate.toFixed(1)}x)`;
    }
  }
}

function updateFeedbackUI() {
  const showFeedback = document.getElementById('showFeedback');
  const feedbackDurationSlider = document.getElementById('feedbackDurationSlider');
  const feedbackDurationValue = document.getElementById('feedbackDurationValue');
  
  if (showFeedback) showFeedback.checked = feedbackSettings.enabled;
  if (feedbackDurationSlider) feedbackDurationSlider.value = feedbackSettings.duration;
  
  if (feedbackDurationValue) {
    const val = feedbackSettings.duration;
    if (val <= 400) feedbackDurationValue.textContent = "Short (" + (val/1000) + "s)";
    else if (val >= 1500) feedbackDurationValue.textContent = "Long (" + (val/1000) + "s)";
    else feedbackDurationValue.textContent = "Normal (" + (val/1000) + "s)";
  }
}

function addSessionToHistory() {
  if (sessionHistory.length === 0 || totalAttempts < 50) return;
  
  const sessionData = {
    date: new Date().toISOString(),
    totalCorrect: totalCorrect,
    totalAttempts: totalAttempts,
    accuracy: totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0,
    sessionDuration: sessionDuration,
    lowestISI: lowestISI,
    mode: isStandardMode ? 'Standard' : isManualMode ? 'Manual' : 'Custom',
    nbackValue: nbackValue,
    trials: sessionHistory.length,
    averageResponseTime: calculateAverageResponseTime(),
    consecutiveCorrectMax: Math.max(...Array.from({length: sessionHistory.length}, (_, i) => {
      let count = 0;
      for (let j = i; j < sessionHistory.length && sessionHistory[j].correct; j++) count++;
      return count;
    }))
  };
  
  allSessions.push(sessionData);
  saveSessions();
}

function calculateAverageResponseTime() {
  const responseTimes = sessionHistory.filter(trial => trial.responseTime !== undefined).map(trial => trial.responseTime);
  if (responseTimes.length === 0) return 0;
  return Math.round(responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length);
}

function calculateTrainingStreaks() {
  if (allSessions.length === 0) {
    return { currentStreak: 0, longestStreak: 0, totalTrainingDays: 0, lastTrainingDate: null };
  }
  
  const sortedSessions = [...allSessions].sort((a, b) => new Date(a.date) - new Date(b.date));
  let currentStreak = 0, longestStreak = 0, tempStreak = 0, lastDate = null;
  
  const uniqueDates = [...new Set(sortedSessions.map(session => new Date(session.date).toDateString()))].sort();
  const totalTrainingDays = uniqueDates.length;
  const lastTrainingDate = uniqueDates.length > 0 ? uniqueDates[uniqueDates.length - 1] : null;
  
  for (let i = 0; i < uniqueDates.length; i++) {
    const currentDate = new Date(uniqueDates[i]);
    
    if (lastDate === null) {
      tempStreak = 1;
    } else {
      const daysDiff = Math.floor((currentDate - new Date(lastDate)) / (1000 * 60 * 60 * 24));
      tempStreak = daysDiff === 1 ? tempStreak + 1 : 1;
    }
    
    longestStreak = Math.max(longestStreak, tempStreak);
    lastDate = currentDate;
  }
  
  if (uniqueDates.length > 0) {
    const today = new Date().toDateString();
    const mostRecentDate = new Date(uniqueDates[uniqueDates.length - 1]);
    const daysSinceLastTraining = Math.floor((new Date(today) - mostRecentDate) / (1000 * 60 * 60 * 24));
    currentStreak = daysSinceLastTraining <= 1 ? tempStreak : 0;
  }
  
  return { currentStreak, longestStreak, totalTrainingDays, lastTrainingDate };
}

function updateProgressDisplay() {
  if (allSessions.length === 0) {
    document.getElementById('totalSessions').textContent = '0';
    document.getElementById('totalQuestions').textContent = '0';
    document.getElementById('avgAccuracy').textContent = '0%';
    document.getElementById('recentSessionsList').innerHTML = '<p class="text-muted text-center py-8">훈련 세션이 없습니다.</p>';
    return;
  }
  
  let validSessions = allSessions.filter(session => session.totalAttempts >= 50);
  
  if (validSessions.length === 0) {
    document.getElementById('totalSessions').textContent = '0';
    document.getElementById('totalQuestions').textContent = '0';
    document.getElementById('avgAccuracy').textContent = '0%';
    document.getElementById('recentSessionsList').innerHTML = '<p class="text-muted text-center py-8">유효한 세션이 없습니다.</p>';
    return;
  }
  
  const totalSessions = validSessions.length;
  const totalQuestions = validSessions.reduce((sum, session) => sum + session.totalAttempts, 0);
  const avgAccuracy = totalQuestions > 0 ? Math.round(validSessions.reduce((sum, session) => sum + (session.accuracy * session.totalAttempts), 0) / totalQuestions) : 0;
  
  document.getElementById('totalSessions').textContent = totalSessions;
  document.getElementById('totalQuestions').textContent = totalQuestions;
  document.getElementById('avgAccuracy').textContent = `${avgAccuracy}%`;
  
  const recentSessionsList = document.getElementById('recentSessionsList');
  recentSessionsList.innerHTML = '';
  
  const recentSessions = validSessions.slice(-10).reverse();
  recentSessions.forEach(session => {
    const sessionItem = document.createElement('div');
    sessionItem.className = 'bg-gray-50 hover:bg-gray-100 p-4 rounded-lg border transition-colors';
    
    const date = new Date(session.date).toLocaleDateString();
    const time = new Date(session.date).toLocaleTimeString();
    
    sessionItem.innerHTML = `
      <div class="flex justify-between items-center">
        <div class="font-medium">${session.mode} Mode (${session.nbackValue || 1}-back)</div>
        <div class="text-gray-600">${date} ${time}</div>
      </div>
      <div class="grid grid-cols-4 gap-4 mt-2 text-sm">
        <div><div class="text-gray-500">정확도</div><div class="font-semibold">${session.accuracy}%</div></div>
        <div><div class="text-gray-500">문제 수</div><div class="font-semibold">${session.totalAttempts}</div></div>
        <div><div class="text-gray-500">최소 간격</div><div class="font-semibold">${session.lowestISI}ms</div></div>
        <div><div class="text-gray-500">평균 반응</div><div class="font-semibold">${session.averageResponseTime}ms</div></div>
      </div>
    `;
    recentSessionsList.appendChild(sessionItem);
  });
}

function updateCumulativeStats() {
  const totalSessions = allSessions.length;
  const totalQuestions = allSessions.reduce((sum, session) => sum + session.totalAttempts, 0);
  const totalCorrect = allSessions.reduce((sum, session) => sum + session.totalCorrect, 0);
  const cumulativeAccuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
  const bestSessionAccuracy = allSessions.length > 0 ? Math.max(...allSessions.map(session => session.accuracy)) : 0;
  const streakData = calculateTrainingStreaks();
  
  const cumulativeSessions = document.getElementById('cumulativeSessions');
  const cumulativeQuestions = document.getElementById('cumulativeQuestions');
  const cumulativeAccuracyElement = document.getElementById('cumulativeAccuracy');
  const bestSessionAccuracyElement = document.getElementById('bestSessionAccuracy');
  
  if (cumulativeSessions) cumulativeSessions.textContent = totalSessions;
  if (cumulativeQuestions) cumulativeQuestions.textContent = totalQuestions;
  if (cumulativeAccuracyElement) cumulativeAccuracyElement.textContent = `${cumulativeAccuracy}%`;
  if (bestSessionAccuracyElement) bestSessionAccuracyElement.textContent = `${bestSessionAccuracy}%`;
}

function shouldIgnoreInput(userInputValue) {
  if (userInputValue === null || isNaN(userInputValue)) return false;
  if (correctAnswer === null) return true;
  
  const numInput = Number(userInputValue);

  if (STRICT_INPUT_MODE) {
    const strInput = String(userInputValue);
    const strCorrect = String(correctAnswer);
    if (numInput === correctAnswer) return false;
    if (strCorrect.startsWith(strInput)) return false;
    return true;
  }

  if (IGNORE_LATE_ANSWERS) {
    if (numInput === previousRoundAnswer && (Date.now() - lastRoundChangeTime < 1500)) {
      console.log("늦은 답변 감지됨");
      return true;
    }
  }

  return false;
}

window.addEventListener('DOMContentLoaded', function() {
  loadSessions();
  loadCustomModeSettings();
  loadManualModeSettings();
  loadNbackSettings();
  loadBeepSettings();
  loadAudioSpeedSettings();
  loadFeedbackSettings();
  loadThemePreference();


  
  document.documentElement.style.setProperty('--numberpad-button-size', '1');
  
  descriptionScreen = document.getElementById('descriptionScreen');
  trainingScreen = document.getElementById('trainingScreen');
  resultsScreen = document.getElementById('resultsScreen');
  startTraining = document.getElementById('startTraining');
  endTraining = document.getElementById('endTraining');
  startNewTraining = document.getElementById('startNewTraining');
  customMode = document.getElementById('customMode');
  manualMode = document.getElementById('manualMode');
  statusMessage = document.getElementById('statusMessage');
  answerInput = document.getElementById('answerInput');
  currentISI = document.getElementById('currentISI');
  timerCircle = document.getElementById('timerCircle');
  minutesLeft = document.getElementById('minutesLeft');
  secondsLeft = document.getElementById('secondsLeft');
  correctCount = document.getElementById('correctCount');
  totalCount = document.getElementById('totalCount');
  accuracyRate = document.getElementById('accuracyRate');
  minISI = document.getElementById('minISI');
  historyContainer = document.getElementById('historyContainer');
  useNumberPadToggle = document.getElementById('useNumberPad');
  numberpad = document.getElementById('numberpad');
  numberpadButtons = document.querySelectorAll('.numberpad-button');
  
  initializeHowlerAudio();
  initializeBeepAudio();
  updateBeepUI();
  updateAudioSpeedUI();
  updateFeedbackUI();
  updateCumulativeStats();
  
  if (isCustomMode) {
    const durationSelect = document.getElementById('durationSelect');
    const startingIntervalSelect = document.getElementById('startingIntervalSelect');
    const minimumIntervalSelect = document.getElementById('minimumIntervalSelect');
    
    if (durationSelect) durationSelect.value = customModeSettings.sessionDuration || 20;
    if (startingIntervalSelect) startingIntervalSelect.value = customModeSettings.selectedISI || 3000;
    if (minimumIntervalSelect) minimumIntervalSelect.value = minimumISI || 2000;
    
    selectedISI = customModeSettings.selectedISI || 3000;
    sessionDuration = customModeSettings.sessionDuration || 20;
  }
  
  const minimumIntervalRow = document.getElementById('minimumIntervalRow');
  const manualIntervalRow = document.getElementById('manualIntervalRow');
  const startingIntervalSelect = document.getElementById('startingIntervalSelect');
  
  if (customMode) {
    customMode.addEventListener('click', function() {
      customMode.classList.add('active');
      manualMode.classList.remove('active');
      isCustomMode = true;
      isManualMode = false;
      isStandardMode = false;

      if (startingIntervalSelect) startingIntervalSelect.style.display = '';
      if (minimumIntervalRow) minimumIntervalRow.style.display = 'block';
      if (manualIntervalRow) manualIntervalRow.style.display = 'none';
      
      selectedISI = customModeSettings.selectedISI || 3000;
      sessionDuration = customModeSettings.sessionDuration || 20;
      
      const durationSelect = document.getElementById('durationSelect');
      if (durationSelect) durationSelect.value = sessionDuration;
      if (startingIntervalSelect) startingIntervalSelect.value = selectedISI;
    });
  }
  
  if (manualMode) {
    manualMode.addEventListener('click', function() {
      manualMode.classList.add('active');
      customMode.classList.remove('active');
      isManualMode = true;
      isCustomMode = false;
      isStandardMode = false;

    if (startingIntervalSelect) startingIntervalSelect.style.display = 'none';

      
      if (minimumIntervalRow) minimumIntervalRow.style.display = 'none';
      if (manualIntervalRow) manualIntervalRow.style.display = 'block';
      
      selectedISI = manualModeSettings.selectedISI || 5000;
      sessionDuration = manualModeSettings.sessionDuration || 20;
      
      const durationSelect = document.getElementById('durationSelect');
      const intervalInput = document.getElementById('intervalInput');
      if (durationSelect) durationSelect.value = sessionDuration;
      if (intervalInput) intervalInput.value = (selectedISI / 1000).toFixed(1);
    });
  }

  const settingsTab = document.getElementById('settingsTab');
  const settingsModal = document.getElementById('settingsModal');
  const closeSettings = document.getElementById('closeSettings');
  
  if (settingsTab) settingsTab.addEventListener('click', () => { if (settingsModal) settingsModal.classList.remove('hidden'); });
  if (closeSettings) closeSettings.addEventListener('click', () => { if (settingsModal) settingsModal.classList.add('hidden'); });

  const helpTab = document.getElementById('helpTab');
  const helpModal = document.getElementById('helpModal');
  const closeHelp = document.getElementById('closeHelp');
  
  if (helpTab) helpTab.addEventListener('click', () => { if (helpModal) helpModal.classList.remove('hidden'); });
  if (closeHelp) closeHelp.addEventListener('click', () => { if (helpModal) helpModal.classList.add('hidden'); });

  const progressTab = document.getElementById('progressTab');
  const progressModal = document.getElementById('progressModal');
  const closeProgressModal = document.getElementById('closeProgressModal');
  
  if (progressTab) {
    progressTab.addEventListener('click', () => {
      if (progressModal) {
        progressModal.classList.remove('hidden');
        updateProgressDisplay();
        updateCumulativeStats();
      }
    });
  }
  
  if (closeProgressModal) closeProgressModal.addEventListener('click', () => { if (progressModal) progressModal.classList.add('hidden'); });

  const durationSelect = document.getElementById('durationSelect');
  if (durationSelect) {
    durationSelect.addEventListener('change', function() {
      sessionDuration = parseInt(this.value);
      if (isCustomMode) {
        customModeSettings.sessionDuration = sessionDuration;
        saveCustomModeSettings();
      } else if (isManualMode) {
        manualModeSettings.sessionDuration = sessionDuration;
        localStorage.setItem('pasatManualModeSettings', JSON.stringify(manualModeSettings));
      }
    });
  }

  if (startingIntervalSelect) {
    startingIntervalSelect.addEventListener('change', function() {
      selectedISI = parseInt(this.value);
      if (isCustomMode) {
        customModeSettings.selectedISI = selectedISI;
        saveCustomModeSettings();
      }
    });
  }

  const minimumIntervalSelect = document.getElementById('minimumIntervalSelect');
  if (minimumIntervalSelect) {
    minimumIntervalSelect.addEventListener('change', function() {
      minimumISI = parseInt(this.value);
      localStorage.setItem('pasatMinimumISI', minimumISI.toString());
    });
  }

  const decreaseBtn = document.getElementById('decreaseInterval');
  const increaseBtn = document.getElementById('increaseInterval');
  const intervalInput = document.getElementById('intervalInput');
  
  if (decreaseBtn && intervalInput) {
    decreaseBtn.addEventListener('click', function() {
      let currentValue = parseFloat(intervalInput.value);
      let newValue = Math.max(0.5, currentValue - 0.1);
      intervalInput.value = newValue.toFixed(1);
      selectedISI = newValue * 1000;
      manualModeSettings.selectedISI = selectedISI;
      localStorage.setItem('pasatManualModeSettings', JSON.stringify(manualModeSettings));
    });
  }
  
  if (increaseBtn && intervalInput) {
    increaseBtn.addEventListener('click', function() {
      let currentValue = parseFloat(intervalInput.value);
      let newValue = Math.min(10, currentValue + 0.1);
      intervalInput.value = newValue.toFixed(1);
      selectedISI = newValue * 1000;
      manualModeSettings.selectedISI = selectedISI;
      localStorage.setItem('pasatManualModeSettings', JSON.stringify(manualModeSettings));
    });
  }
  
  if (intervalInput) {
    intervalInput.addEventListener('change', function() {
      let value = parseFloat(this.value);
      value = Math.max(0.5, Math.min(10, value));
      this.value = value.toFixed(1);
      selectedISI = value * 1000;
      manualModeSettings.selectedISI = selectedISI;
      localStorage.setItem('pasatManualModeSettings', JSON.stringify(manualModeSettings));
    });
  }

  const savedMinimumISI = localStorage.getItem('pasatMinimumISI');
  if (savedMinimumISI) {
    minimumISI = parseInt(savedMinimumISI);
    if (minimumIntervalSelect) minimumIntervalSelect.value = minimumISI.toString();
  }

  const nbackInput = document.getElementById('nbackValue');
  if (nbackInput) {
    nbackInput.addEventListener('change', function() {
      const value = parseInt(this.value) || 1;
      const clampedValue = Math.max(1, Math.min(10, value));
      this.value = clampedValue;
      nbackSettings.value = clampedValue;
      saveNbackSettings();
      
      const warningElement = document.getElementById('nbackWarning');
      if (warningElement) {
        if (clampedValue > 1) {
          warningElement.style.display = 'block';
          warningElement.innerHTML = `<div class="bg-yellow-50 border-l-4 border-yellow-400 p-4 mt-3"><p class="text-sm text-yellow-700"><strong>실험 모드:</strong> ${clampedValue}-back은 과학적으로 검증되지 않았습니다.</p></div>`;
        } else {
          warningElement.style.display = 'none';
        }
      }
    });
  }

  const numberpadSizeSlider = document.getElementById('numberpadSizeSlider');
  const numberpadSizeValue = document.getElementById('numberpadSizeValue');
  
  if (numberpadSizeSlider && numberpadSizeValue) {
    numberpadSizeSlider.addEventListener('input', function() {
      const size = parseFloat(this.value);
      const sizeText = size < 0.8 ? '작게' : size > 1.2 ? '크게' : '보통';
      numberpadSizeValue.textContent = sizeText;
      document.documentElement.style.setProperty('--numberpad-button-size', size);
      if (trainingScreen.style.display !== 'none' && useNumberPad) updateNumberpadSize();
    });
  }

  if (useNumberPadToggle) {
    useNumberPadToggle.addEventListener('change', function() {
      useNumberPad = this.checked;
      const sizeControls = document.getElementById('numberpadSizeControls');
      if (sizeControls) sizeControls.style.display = useNumberPad ? 'block' : 'none';
      
      if (trainingScreen.style.display !== 'none') {
        if (useNumberPad) {
          answerInput.style.display = 'none';
          numberpad.style.display = 'grid';
          answerInput.value = '';
        } else {
          answerInput.style.display = 'block';
          numberpad.style.display = 'none';
          numberpadButtons.forEach(btn => btn.classList.remove('selected'));
          answerInput.focus();
        }
      }
    });
  }

  const useErrorBeepToggle = document.getElementById('useErrorBeep');
  const beepVolumeSlider = document.getElementById('beepVolumeSlider');
  const beepVolumeValue = document.getElementById('beepVolumeValue');
  
  if (useErrorBeepToggle) {
    useErrorBeepToggle.addEventListener('change', function() {
      beepSettings.enabled = this.checked;
      const volumeControls = document.getElementById('beepVolumeControls');
      if (volumeControls) volumeControls.style.display = beepSettings.enabled ? 'block' : 'none';
      saveBeepSettings();
    });
  }
  
  if (beepVolumeSlider && beepVolumeValue) {
    beepVolumeSlider.addEventListener('input', function() {
      const volume = parseFloat(this.value);
      beepSettings.volume = volume;
      let volumeText = '보통';
      if (volume <= 0.3) volumeText = '작게';
      else if (volume > 0.7) volumeText = '크게';
      beepVolumeValue.textContent = volumeText;
      if (beepSound) beepSound.volume(volume);
      saveBeepSettings();
    });
  }

  const audioSpeedSlider = document.getElementById('audioSpeedSlider');
  const audioSpeedValue = document.getElementById('audioSpeedValue');
  
  if (audioSpeedSlider && audioSpeedValue) {
    audioSpeedSlider.addEventListener('input', function() {
      const rate = parseFloat(this.value);
      audioSpeedSettings.rate = rate;
      audioSpeedValue.textContent = rate === 1.0 ? '보통 (1.0배속)' : `빠르게 (${rate.toFixed(1)}배속)`;
      saveAudioSpeedSettings();
    });
  }

  const showFeedback = document.getElementById('showFeedback');
  const feedbackDurationSlider = document.getElementById('feedbackDurationSlider');
  const feedbackDurationValue = document.getElementById('feedbackDurationValue');
  
  if (showFeedback) {
    showFeedback.addEventListener('change', function() {
      feedbackSettings.enabled = this.checked;
      saveFeedbackSettings();
    });
  }
  
  if (feedbackDurationSlider && feedbackDurationValue) {
    feedbackDurationSlider.addEventListener('input', function() {
      const duration = parseInt(this.value);
      feedbackSettings.duration = duration;
      const val = duration;
      if (val <= 400) feedbackDurationValue.textContent = "짧게 (" + (val/1000) + "초)";
      else if (val >= 1500) feedbackDurationValue.textContent = "길게 (" + (val/1000) + "초)";
      else feedbackDurationValue.textContent = "보통 (" + (val/1000) + "초)";
      saveFeedbackSettings();
    });
  }

  function handleButtonInteraction(e) {
    e.preventDefault();
    if (Date.now() < inputBlockedUntil || !canProcessButtonClick()) {
      numberpadButtons.forEach(b => b.classList.remove('selected'));
      return;
    }

    const btn = e.currentTarget;
    const value = parseInt(btn.getAttribute('data-value'));

    if (shouldIgnoreInput(value)) {
      numberpadButtons.forEach(b => b.classList.remove('selected'));
      return;
    }

    numberpadButtons.forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');

    if (shouldProcessAnswerImmediately(value)) {
      answerProcessed = true;
      const success = processAnswer(value);
      if (!success) {
        answerProcessed = false;
        numberpadButtons.forEach(b => b.classList.remove('selected'));
      }
    } else {
      btn.classList.add('incorrect-selection');
      setTimeout(() => btn.classList.remove('incorrect-selection'), 300);
    }
  }

  numberpadButtons.forEach(button => {
    button.addEventListener('mousedown', handleButtonInteraction);
    button.addEventListener('touchstart', handleButtonInteraction, {passive: false});
  });

  if (startTraining) startTraining.addEventListener('click', startSession);
  if (endTraining) endTraining.addEventListener('click', endSession);
  if (startNewTraining) {
    startNewTraining.addEventListener('click', function() {
      resultsScreen.style.display = 'none';
      descriptionScreen.style.display = 'block';
    });
  }

  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) themeToggle.addEventListener('click', toggleTheme);

  if (answerInput) {
    answerInput.addEventListener('input', function(e) {
      if (Date.now() < inputBlockedUntil) {
        answerInput.value = '';
        return;
      }
      if (!canProcessButtonClick()) return;

      const typedValue = answerInput.value.trim();
      if (!typedValue || isNaN(Number(typedValue))) {
        answerInput.value = '';
        return;
      }

      const currentInputNum = Number(typedValue);
      const strCorrect = String(correctAnswer);
      const strInput = String(typedValue);

      if (STRICT_INPUT_MODE) {
        if (currentInputNum === correctAnswer) {
          answerProcessed = true;
          const success = processAnswer(currentInputNum);
          if (success) answerInput.value = '';
          else answerProcessed = false;
          return;
        }
        if (strCorrect.startsWith(strInput)) return;
        answerInput.value = '';
        return;
      }

      if (IGNORE_LATE_ANSWERS) {
        if (currentInputNum === previousRoundAnswer && (Date.now() - lastRoundChangeTime < 1500)) {
          console.log("늦은 답변 무시됨");
          answerInput.value = '';
          return;
        }
      }

      if (currentInputNum === correctAnswer) {
        answerProcessed = true;
        const success = processAnswer(currentInputNum);
        if (success) answerInput.value = '';
        else answerProcessed = false;
      }
    });

    answerInput.addEventListener('keyup', function(event) {
      if (event.key === 'Enter' && answerInput.value.trim() !== '') {
        if (!answerProcessed && canProcessButtonClick()) {
          const userInput = answerInput.value.trim();
          const userAnswer = Number(userInput);
          if (!isNaN(userAnswer) && userInput.length > 0 && userAnswer === correctAnswer) {
            answerProcessed = true;
            const success = processAnswer(userAnswer);
            if (!success) answerProcessed = false;
          }
        }
      }
    });
  }

  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', function(e) {
      if (e.target === modal || e.target.classList.contains('modal-overlay')) {
        modal.classList.add('hidden');
      }
    });
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      const modals = document.querySelectorAll('.modal');
      modals.forEach(modal => {
        if (!modal.classList.contains('hidden')) modal.classList.add('hidden');
      });
    }
  });
});

document.addEventListener('visibilitychange', function() {});

window.addEventListener('beforeunload', function() {
  stopAllAudio();
  if (trainingTimerId) {
    clearInterval(trainingTimerId);
    trainingTimerId = null;
  }
  if (currentIntervalId) {
    clearTimeout(currentIntervalId);
    currentIntervalId = null;
  }
  
  try {
    for (let i = 1; i <= 9; i++) {
      if (numberSounds[i]) {
        numberSounds[i].stop();
        numberSounds[i].unload();
      }
    }
    if (beepSound) {
      beepSound.stop();
      beepSound.unload();
    }
  } catch (e) {}
});