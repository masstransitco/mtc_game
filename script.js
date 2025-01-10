/*********************************************************************
 * script.js
 * 
 * Enhanced Three.js mini-game with separate HTML/CSS files.
 * 
 * 1) Minimal physics: bounding boxes, mild “inertia”.
 * 2) Progressive difficulty: obstacle speeds ramp up with time.
 * 3) Basic object pooling for obstacles.
 * 4) Sleeker UI with start screen, dark theme, simplified collisions.
 *********************************************************************/

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.152.0/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.152.0/examples/jsm/loaders/GLTFLoader.js';

// ============== GLOBAL VARIABLES & STATE ====================
let scene, camera, renderer;
let environmentGroup;
let MTC;                 // The user’s car
let userCarLoaded = false;
let taxiModel;           // Template for obstacle
let obstacles = [];      // Active obstacles
let obstaclePool = [];   // Pool for reusing obstacles
const maxObstacles = 8;  // Limit how many obstacles can exist
let lanePositions = [-4, -2, 0, 2, 4];

const baseVelocity = 6.944;    // ~25 km/h in m/s
const minVelocity = 0.278;     // ~1 km/h
const maxVelocity = 44.444;    // ~160 km/h
let velocity = baseVelocity;

let accelerateInput = false;
let decelerateInput = false;
let moveLeft = false;
let moveRight = false;

let gameOver = false;
let gameCompleted = false;
let collisionCount = 0;

let distance = 0;       // meters
let elapsedTime = 0;    // seconds
let startTime = 0;      // ms
let previousTime = 0;   // ms
let animationId;

let scoreboard = 0;     // A simple “score” system

// Leaderboard
let leaderboard = JSON.parse(localStorage.getItem('leaderboard')) || [];

const obstacleFrequency = 2;   // spawn new obstacle every 2s
let obstacleTimer = 0;
let difficultyRamp = 0.0;      // increases obstacle speed over time

// ============== SETUP SCENE, CAMERA, RENDERER ==================
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1C262D);

  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    3000
  );
  camera.position.set(0, 5, 15);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  // Basic lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 20, 10);
  dirLight.castShadow = true;
  scene.add(dirLight);

  environmentGroup = new THREE.Group();
  scene.add(environmentGroup);

  window.addEventListener('resize', onWindowResize, false);
}

// ============== HANDLE WINDOW RESIZE ==========================
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ============== LOAD MODELS (User Car, Obstacle) ==============
function loadModels() {
  const loader = new GLTFLoader();

  // 1) User Car
  loader.load(
    'mtc.glb',
    (gltf) => {
      MTC = gltf.scene;
      MTC.scale.set(2.2, 2.2, 2.2);
      MTC.position.set(0, 1.1, 0);
      MTC.castShadow = true;
      MTC.receiveShadow = true;
      environmentGroup.add(MTC);
      userCarLoaded = true;
    },
    undefined,
    (err) => {
      console.error('Error loading mtc.glb', err);
    }
  );

  // 2) Obstacle (Taxi)
  loader.load(
    'taxi.glb',
    (gltf) => {
      taxiModel = gltf.scene;
      taxiModel.scale.set(0.5, 0.5, 0.5);
      taxiModel.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
    },
    undefined,
    (err) => {
      console.error('Error loading taxi.glb', err);
    }
  );
}

// ============== ENVIRONMENT SETUP (Road, etc.) ================
function setupEnvironment() {
  const roadWidth = 12;
  const roadLength = 2000;
  const roadGeometry = new THREE.PlaneGeometry(roadWidth, roadLength);
  const roadMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const road = new THREE.Mesh(roadGeometry, roadMaterial);
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0;
  road.receiveShadow = true;
  environmentGroup.add(road);

  // Lane markers
  const lanes = lanePositions;
  const markerSpacing = 10; // smaller spacing for more frequent lines
  const markerLength = 1;
  for (let z = -roadLength / 2; z < roadLength / 2; z += markerSpacing) {
    lanes.forEach((lane) => {
      const markerGeom = new THREE.BoxGeometry(0.1, 0.01, markerLength);
      const markerMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const marker = new THREE.Mesh(markerGeom, markerMat);
      marker.position.set(lane, 0.01, z);
      marker.rotation.x = -Math.PI / 2;
      environmentGroup.add(marker);
    });
  }

  // Simple “barriers” on left and right
  const barrierHeight = 1.2;
  const barrierWidth = 0.5;
  const barrierGeom = new THREE.BoxGeometry(barrierWidth, barrierHeight, roadLength);
  const barrierMat = new THREE.MeshLambertMaterial({ color: 0xffffff });

  const barrierLeft = new THREE.Mesh(barrierGeom, barrierMat);
  barrierLeft.position.set(-roadWidth / 2 - barrierWidth / 2, barrierHeight / 2, 0);
  barrierLeft.receiveShadow = true;
  barrierLeft.castShadow = true;
  environmentGroup.add(barrierLeft);

  const barrierRight = new THREE.Mesh(barrierGeom, barrierMat);
  barrierRight.position.set(roadWidth / 2 + barrierWidth / 2, barrierHeight / 2, 0);
  barrierRight.receiveShadow = true;
  barrierRight.castShadow = true;
  environmentGroup.add(barrierRight);
}

// ============== SETUP OBSTACLE POOL ===========================
function initObstaclePool() {
  // If we have a taxiModel, clone a few times
  if (!taxiModel) return;
  for (let i = 0; i < maxObstacles; i++) {
    const obstacle = taxiModel.clone();
    obstacle.visible = false;
    environmentGroup.add(obstacle);
    obstaclePool.push(obstacle);
  }
}

// Reuse or get a new obstacle
function getObstacleFromPool() {
  for (let i = 0; i < obstaclePool.length; i++) {
    if (!obstaclePool[i].visible) {
      return obstaclePool[i];
    }
  }
  return null; // none available
}

// ============== SPAWN OBSTACLES ===============================
function spawnObstacle() {
  if (!taxiModel || !userCarLoaded) return;

  const obstacle = getObstacleFromPool();
  if (!obstacle) return; // if none available, skip

  obstacle.visible = true;
  // Random lane
  const lane = lanePositions[Math.floor(Math.random() * lanePositions.length)];

  // Decide if it spawns behind or ahead
  const spawnBehind = Math.random() < 0.5;
  let spawnZ;
  const proximity = 60; // how close behind it might spawn
  if (spawnBehind) {
    // spawn behind
    spawnZ = MTC.position.z + (Math.random() * -proximity - 10);
  } else {
    // spawn ahead
    spawnZ = MTC.position.z - 100 - Math.random() * 50;
  }

  obstacle.position.set(lane, 0.2, spawnZ);
  obstacle.rotation.y = Math.PI; // face forward
  obstacle.userData.speed = (22.222 + difficultyRamp) + Math.random() * 10; // ~80 km/h + ramp
}

// ============== UPDATE OBSTACLES ==============================
function updateObstacles(deltaTime) {
  obstacles.forEach((obs) => {
    if (!obs.visible) return;
    obs.position.z -= obs.userData.speed * deltaTime;

    // If the obstacle is far ahead of camera (i.e., behind the car)
    if (obs.position.z < MTC.position.z - 200) {
      obs.visible = false; // recycle
    }
  });
}

// ============== COLLISION DETECTION ===========================
function checkCollisions() {
  if (!MTC) return;
  const carBox = new THREE.Box3().setFromObject(MTC).expandByScalar(0.3);

  obstacles.forEach((obs) => {
    if (!obs.visible) return;
    const obsBox = new THREE.Box3().setFromObject(obs).expandByScalar(0.3);
    if (carBox.intersectsBox(obsBox)) {
      handleCollision();
      obs.visible = false; // remove obstacle
    }
  });
}

// ============== HANDLE COLLISION ==============================
function handleCollision() {
  collisionCount++;
  console.log(`Collision #${collisionCount}`);

  // Warning or end game
  if (collisionCount < 3) {
    displayWarningIndicator();
  } else {
    triggerGameOver();
  }
}

// ============== WARNING INDICATOR =============================
function displayWarningIndicator() {
  const warningIndicator = document.getElementById('warningIndicator');
  // First collision
  if (collisionCount === 1) {
    warningIndicator.style.display = 'block';
    warningIndicator.classList.add('flashing');
  } else if (collisionCount === 2) {
    // Increase flash frequency
    warningIndicator.classList.remove('flashing');
    warningIndicator.style.animation = 'flash 0.5s infinite';
  }
}

// ============== GAME OVER =====================================
function triggerGameOver() {
  if (gameOver) return;
  gameOver = true;
  cancelAnimationFrame(animationId);

  document.getElementById('finalTime').textContent = formatTime(elapsedTime);
  document.getElementById('gameOver').style.display = 'block';
  document.getElementById('speedometer').style.display = 'none';
  document.getElementById('warningIndicator').style.display = 'none';
}

// ============== GAME COMPLETE =================================
function handleGameCompletion() {
  gameCompleted = true;
  cancelAnimationFrame(animationId);

  document.getElementById('completionTime').textContent = formatTime(elapsedTime);
  updateLeaderboard();

  document.getElementById('gameComplete').style.display = 'block';
  document.getElementById('speedometer').style.display = 'none';
  document.getElementById('warningIndicator').style.display = 'none';

  // Hide obstacles
  obstacles.forEach((obs) => (obs.visible = false));
  obstacles = [];
}

// ============== LEADERBOARD ===================================
function updateLeaderboard() {
  let position = null;
  for (let i = 0; i < leaderboard.length; i++) {
    if (elapsedTime < leaderboard[i].time) {
      position = i;
      break;
    }
  }
  if (leaderboard.length < 10 && position === null) {
    position = leaderboard.length;
  }
  if (position !== null) {
    // Prompt for name
    document.getElementById('nameInputContainer').style.display = 'block';
    const submitButton = document.getElementById('submitNameButton');

    // Clean old listeners
    submitButton.replaceWith(submitButton.cloneNode(true));
    const newSubmit = document.getElementById('submitNameButton');
    newSubmit.addEventListener('click', () => {
      const name = document.getElementById('nameInput').value.trim() || 'Anonymous';
      leaderboard.splice(position, 0, { name, time: elapsedTime });
      if (leaderboard.length > 10) {
        leaderboard.pop();
      }
      localStorage.setItem('leaderboard', JSON.stringify(leaderboard));
      displayLeaderboard();
      document.getElementById('nameInputContainer').style.display = 'none';
      document.getElementById('gameComplete').style.display = 'none';
    });
  } else {
    displayLeaderboard();
  }
  updateBestTimeDisplay();
}

function displayLeaderboard() {
  const leaderboardList = document.getElementById('leaderboardList');
  leaderboardList.innerHTML = '';
  leaderboard.forEach((entry, index) => {
    const li = document.createElement('li');
    let medal = '';
    if (index === 0) medal = '🥇';
    else if (index === 1) medal = '🥈';
    else if (index === 2) medal = '🥉';
    else medal = `${index + 1}.`;
    li.innerHTML = `<span>${medal} ${entry.name}</span><span>${formatTime(entry.time)}</span>`;
    leaderboardList.appendChild(li);
  });
}

function updateBestTimeDisplay() {
  if (leaderboard.length > 0) {
    document.getElementById('bestTime').textContent = `Best Time: ${formatTime(leaderboard[0].time)}`;
  } else {
    document.getElementById('bestTime').textContent = `Best Time: N/A`;
  }
}

// ============== FORMATTING TIME ===============================
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}.${millis}`;
}

// ============== ANIMATION LOOP ================================
function animate() {
  if (gameOver || gameCompleted) return;

  animationId = requestAnimationFrame(animate);

  const now = Date.now();
  const deltaTime = (now - previousTime) / 1000;
  previousTime = now;

  // Elapsed time
  elapsedTime = (now - startTime) / 1000;
  document.getElementById('time').textContent = `Time: ${formatTime(elapsedTime)}`;

  // Progressive difficulty ramp
  difficultyRamp = elapsedTime * 0.2; // Very mild increase over time

  // Distance
  distance += velocity * deltaTime;
  document.getElementById('distance').textContent = `Distance: ${distance.toFixed(1)} m`;

  // Basic scoring (1 point per meter, for example)
  scoreboard = Math.floor(distance);
  document.getElementById('score').textContent = `Score: ${scoreboard}`;

  // Check completion condition (1000m)
  if (distance >= 1000) {
    handleGameCompletion();
    return;
  }

  // Joystick input -> accelerate/decelerate
  if (accelerateInput) {
    velocity = Math.min(velocity + 5 * deltaTime, maxVelocity);
  } else if (decelerateInput) {
    velocity = Math.max(velocity - 5 * deltaTime, minVelocity);
  } else {
    // mild inertia: converge back to base velocity
    if (velocity > baseVelocity) {
      velocity = Math.max(velocity - 2 * deltaTime, baseVelocity);
    } else if (velocity < baseVelocity) {
      velocity = Math.min(velocity + 2 * deltaTime, baseVelocity);
    }
  }

  // Update speedometer
  document.getElementById('speedometer').textContent = `${(velocity * 3.6).toFixed(0)} km/h`;

  // Car forward movement
  if (MTC) {
    MTC.position.z -= velocity * deltaTime;
  }

  // L-R Steering
  if (moveLeft) {
    MTC.position.x -= 0.05;
    MTC.rotation.z = 0.1;
  } else if (moveRight) {
    MTC.position.x += 0.05;
    MTC.rotation.z = -0.1;
  } else {
    // drift back upright
    MTC.rotation.z *= 0.9;
  }

  // obstacles
  updateObstacles(deltaTime);
  // spawn timing
  obstacleTimer += deltaTime;
  if (obstacleTimer >= obstacleFrequency) {
    spawnObstacle();
    obstacleTimer = 0;
  }

  // check collisions
  checkCollisions();

  // camera follow
  updateCamera();

  renderer.render(scene, camera);
}

function updateCamera() {
  if (!MTC) return;
  const desiredPos = new THREE.Vector3(
    MTC.position.x,
    5,
    MTC.position.z + 15
  );
  camera.position.lerp(desiredPos, 0.1);
  camera.lookAt(MTC.position.x, MTC.position.y, MTC.position.z);
}

// ============== JOYSTICK ==========================
const joystickBase = document.getElementById('joystick-base');
const joystickKnob = document.getElementById('joystick-knob');
let joystickActive = false;
let joystickMaxDistance = joystickBase.offsetWidth / 2;
let joystickX = 0;
let joystickY = 0;

function initJoystick() {
  // For both touch and mouse
  joystickBase.addEventListener('touchstart', onJoystickStart, { passive: false });
  joystickBase.addEventListener('touchmove', onJoystickMove, { passive: false });
  joystickBase.addEventListener('touchend', onJoystickEnd, { passive: false });

  joystickBase.addEventListener('mousedown', onJoystickStart, { passive: false });
  document.addEventListener('mousemove', onJoystickMove, { passive: false });
  document.addEventListener('mouseup', onJoystickEnd, { passive: false });
}

function onJoystickStart(e) {
  e.preventDefault();
  joystickActive = true;
  joystickKnob.classList.add('active');
  updateJoystick(e);
}

function onJoystickMove(e) {
  if (!joystickActive) return;
  e.preventDefault();
  updateJoystick(e);
}

function onJoystickEnd(e) {
  if (!joystickActive) return;
  e.preventDefault();
  joystickActive = false;
  joystickKnob.classList.remove('active');

  // reset
  joystickKnob.style.transition = 'transform 0.3s ease';
  joystickKnob.style.transform = 'translate(0,0)';
  setTimeout(() => {
    joystickKnob.style.transition = 'transform 0.1s ease';
    joystickX = 0;
    joystickY = 0;
  }, 300);

  accelerateInput = false;
  decelerateInput = false;
  moveLeft = false;
  moveRight = false;
}

function updateJoystick(e) {
  let clientX, clientY;
  let rect = joystickBase.getBoundingClientRect();

  if (e.touches) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  } else {
    clientX = e.clientX;
    clientY = e.clientY;
  }

  let x = clientX - rect.left - rect.width / 2;
  let y = clientY - rect.top - rect.height / 2;

  let distance = Math.sqrt(x * x + y * y);
  let angle = Math.atan2(y, x);

  // clamp distance
  let clampedDist = Math.min(distance, joystickMaxDistance);

  joystickX = (clampedDist * Math.cos(angle)) / joystickMaxDistance;
  joystickY = (clampedDist * Math.sin(angle)) / joystickMaxDistance;

  // position knob
  const knobX = joystickX * joystickMaxDistance * 0.6;
  const knobY = joystickY * joystickMaxDistance * 0.6;
  joystickKnob.style.transform = `translate(${knobX}px, ${knobY}px)`;

  // interpret
  const deadZone = 0.2;
  accelerateInput = joystickY > deadZone;
  decelerateInput = joystickY < -deadZone;
  moveLeft = joystickX < -deadZone;
  moveRight = joystickX > deadZone;
}

// ============== START / RESTART ===============================
function startGame() {
  // Hide start screen
  document.getElementById('start-screen').style.display = 'none';
  document.getElementById('instructions').style.display = 'block';

  // Camera overhead then move behind car
  startCameraAnimation();
}

function startCameraAnimation() {
  // Quick manual approach
  const startPos = new THREE.Vector3(0, 30, 100);
  const endPos = new THREE.Vector3(0, 5, 15);
  const duration = 1500;
  const start = Date.now();

  camera.position.copy(startPos);
  camera.lookAt(0, 0, 0);

  function animateCam() {
    const now = Date.now();
    const t = Math.min((now - start) / duration, 1);

    camera.position.lerpVectors(startPos, endPos, t);
    camera.lookAt(0, 0, 0);

    if (t < 1) {
      requestAnimationFrame(animateCam);
    } else {
      // Done, start main loop
      resetGameState();
      animate();
    }
  }
  animateCam();
}

function resetGameState() {
  collisionCount = 0;
  distance = 0;
  scoreboard = 0;
  velocity = baseVelocity;
  gameOver = false;
  gameCompleted = false;

  document.getElementById('gameOver').style.display = 'none';
  document.getElementById('gameComplete').style.display = 'none';
  document.getElementById('warningIndicator').style.display = 'none';
  document.getElementById('warningIndicator').classList.remove('flashing');
  document.getElementById('warningIndicator').style.animation = '';

  if (MTC) {
    MTC.position.set(0, 1.1, 0);
    MTC.rotation.set(0, 0, 0);
  }

  obstacles.forEach((obs) => (obs.visible = false));
  obstacleTimer = 0;
  previousTime = Date.now();
  startTime = previousTime;

  updateBestTimeDisplay();
}

function onRestart() {
  resetGameState();
  animate();
}

function onContinue() {
  // Link to your main site
  window.location.href = 'https://air.zone';
}

// ============== MAIN ==========================================
initScene();
loadModels();
setupEnvironment();
initJoystick();

// Buttons
document.getElementById('play-button').addEventListener('click', startGame);
document.getElementById('restartButton').addEventListener('click', onRestart);
document.getElementById('continueLink').addEventListener('click', onContinue);
document.getElementById('restartButtonComplete').addEventListener('click', onRestart);
document.getElementById('continueLinkComplete').addEventListener('click', onContinue);

// Since taxiModel might load asynchronously, we can poll or do a small delay
setTimeout(() => {
  initObstaclePool();
}, 3000);

// Show the leaderboard initially if any
displayLeaderboard();
updateBestTimeDisplay();
