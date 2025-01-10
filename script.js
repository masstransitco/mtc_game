/*********************************************************************
 * script.js
 * 
 * Three.js Mini-Game with:
 *  - 3 lanes ([-2, 0, 2]) with flat lane markings
 *  - Road plane + side barriers
 *  - Lampposts, traffic lights with poles
 *  - Car (mtc.glb) + obstacle vehicles (taxi, Bus, LGV, Bike)
 *  - Collision detection
 *  - Leaderboard, camera orbit on game completion (2,000m).
 *  - Fixes for the issues reported: fewer lanes, correct lane lines,
 *    visible environment, obstacle spawning, scoreboard, and final orbit.
 *********************************************************************/

// ================== GLOBALS ==================
let scene, camera, renderer;
let environmentGroup;
let MTC; // user car
let userCarLoaded = false;

let obstacleModels = {}; // { taxi, bus, lgv, bike }
let obstaclePool = [];
let obstacles = [];
const obstacleTypes = ["taxi", "bus", "lgv", "bike"];
const maxObstacles = 10;

let lanePositions = [-2, 0, 2]; // Only 3 lanes
let accelerateInput = false,
  decelerateInput = false,
  moveLeft = false,
  moveRight = false;

let velocity = 6.944; // ~25 km/h
const baseVelocity = 6.944;
const minVelocity = 0.278;
const maxVelocity = 44.444;

let collisionCount = 0;
let gameOver = false;
let gameCompleted = false;

let distance = 0; // meters
let scoreboard = 0; // 1 point per meter
let totalCollisions = 0; // track collisions
let elapsedTime = 0; // in seconds
let startTime = 0; // ms
let previousTime = 0; // ms
let animationId;

let obstacleFrequency = 2; // spawn obstacle every 2s
let obstacleTimer = 0;
let difficultyRamp = 0;
const completionDistance = 2000; // 2,000m for game completion

let orbitActive = false;
let orbitStartTime = 0;

// Leaderboard
let leaderboard = JSON.parse(localStorage.getItem("leaderboard")) || [];

// ================== SCENE SETUP ==================
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1C262D);

  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    4000
  );
  camera.position.set(0, 5, 15);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  environmentGroup = new THREE.Group();
  scene.add(environmentGroup);

  // Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 20, 10);
  dirLight.castShadow = true;
  scene.add(dirLight);

  window.addEventListener("resize", onWindowResize, false);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ================== LOAD MODELS ==================
function loadModels() {
  const loader = new THREE.GLTFLoader();

  // 1) User Car
  loader.load(
    "mtc.glb",
    (gltf) => {
      MTC = gltf.scene;
      MTC.scale.set(2.2, 2.2, 2.2);
      MTC.position.set(0, 1.1, 0);
      MTC.castShadow = true;
      MTC.receiveShadow = true;
      environmentGroup.add(MTC);
      userCarLoaded = true;
      console.log("User car loaded (mtc.glb).");
    },
    undefined,
    (err) => console.error("Error loading mtc.glb:", err)
  );

  // 2) Obstacles
  // Taxi
  loader.load("taxi.glb", (gltf) => {
    obstacleModels.taxi = gltf.scene;
    console.log("Taxi loaded.");
  });
  // Bus
  loader.load("Bus.glb", (gltf) => {
    obstacleModels.bus = gltf.scene;
    console.log("Bus loaded.");
  });
  // LGV
  loader.load("LGV.glb", (gltf) => {
    obstacleModels.lgv = gltf.scene;
    console.log("LGV loaded.");
  });
  // Bike
  loader.load("Bike.glb", (gltf) => {
    obstacleModels.bike = gltf.scene;
    console.log("Bike loaded.");
  });
}

// ================== ENVIRONMENT ==================
function setupEnvironment() {
  // Road plane
  const roadWidth = 6; // narrower for 3 lanes
  const roadLength = 4000;
  const roadGeom = new THREE.PlaneGeometry(roadWidth, roadLength);
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const road = new THREE.Mesh(roadGeom, roadMat);
  road.rotation.x = -Math.PI / 2;
  road.receiveShadow = true;
  environmentGroup.add(road);

  // Lane Markings (flat)
  const spacing = 10;
  const lineLength = 1;
  for (let z = -roadLength / 2; z < roadLength / 2; z += spacing) {
    lanePositions.forEach((laneX) => {
      const markerGeom = new THREE.PlaneGeometry(0.08, lineLength);
      const markerMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
      });
      const marker = new THREE.Mesh(markerGeom, markerMat);
      marker.rotation.x = -Math.PI / 2; // lie flat
      marker.position.set(laneX, 0.01, z);
      environmentGroup.add(marker);
    });
  }

  // Side Barriers
  const barrierHeight = 1.2;
  const barrierThickness = 0.2;
  const barrierGeom = new THREE.BoxGeometry(barrierThickness, barrierHeight, roadLength);
  const barrierMat = new THREE.MeshLambertMaterial({ color: 0xffffff });

  // Left barrier
  const barrierLeft = new THREE.Mesh(barrierGeom, barrierMat);
  barrierLeft.position.set(-roadWidth / 2 - barrierThickness / 2, barrierHeight / 2, 0);
  barrierLeft.castShadow = true;
  barrierLeft.receiveShadow = true;
  environmentGroup.add(barrierLeft);

  // Right barrier
  const barrierRight = new THREE.Mesh(barrierGeom, barrierMat);
  barrierRight.position.set(roadWidth / 2 + barrierThickness / 2, barrierHeight / 2, 0);
  barrierRight.castShadow = true;
  barrierRight.receiveShadow = true;
  environmentGroup.add(barrierRight);

  // Let's add lampposts every 50 meters
  for (let z = -roadLength / 2; z < roadLength / 2; z += 50) {
    createLamppost(-roadWidth / 2 - 1, z);
    createLamppost(roadWidth / 2 + 1, z);
  }

  // Traffic lights every 200 meters
  for (let z = -roadLength / 2; z < roadLength / 2; z += 200) {
    createTrafficLight(-roadWidth / 2 - 2, z);
    createTrafficLight(roadWidth / 2 + 2, z);
  }
}

// Helper: create a lamppost with a tall pole
function createLamppost(x, z) {
  const poleGeom = new THREE.CylinderGeometry(0.05, 0.05, 4, 8);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
  const pole = new THREE.Mesh(poleGeom, poleMat);
  pole.position.set(x, 2, z);
  pole.castShadow = true;
  environmentGroup.add(pole);

  // Light sphere at top
  const lampGeom = new THREE.SphereGeometry(0.2, 8, 8);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffaa });
  const lamp = new THREE.Mesh(lampGeom, lampMat);
  lamp.position.set(x, 4, z);
  environmentGroup.add(lamp);

  // Real light
  const light = new THREE.PointLight(0xffffaa, 0.7, 10);
  light.position.set(x, 4, z);
  environmentGroup.add(light);
}

// Helper: create a traffic light with a pole
function createTrafficLight(x, z) {
  // pole
  const poleGeom = new THREE.CylinderGeometry(0.06, 0.06, 3, 8);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
  const pole = new THREE.Mesh(poleGeom, poleMat);
  pole.position.set(x, 1.5, z);
  pole.castShadow = true;
  environmentGroup.add(pole);

  // Light box
  const boxGeom = new THREE.BoxGeometry(0.4, 1, 0.4);
  const boxMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
  const box = new THREE.Mesh(boxGeom, boxMat);
  box.position.set(x, 3, z);
  environmentGroup.add(box);

  // 3 colored bulbs
  const bulbGeom = new THREE.SphereGeometry(0.1, 8, 8);
  const redMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const yellowMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
  const greenMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });

  const redBulb = new THREE.Mesh(bulbGeom, redMat);
  redBulb.position.set(0, 0.3, 0);
  box.add(redBulb);

  const yellowBulb = new THREE.Mesh(bulbGeom, yellowMat);
  yellowBulb.position.set(0, 0, 0);
  box.add(yellowBulb);

  const greenBulb = new THREE.Mesh(bulbGeom, greenMat);
  greenBulb.position.set(0, -0.3, 0);
  box.add(greenBulb);
}

// ================== OBSTACLE POOL ==================
function initObstaclePool() {
  // Check if all models loaded
  let loadedAll = obstacleTypes.every((t) => obstacleModels[t]);
  if (!loadedAll) {
    console.warn("Obstacle models not fully loaded yet. Retrying in 2s...");
    setTimeout(() => initObstaclePool(), 2000);
    return;
  }

  for (let i = 0; i < maxObstacles; i++) {
    let type = obstacleTypes[i % obstacleTypes.length];
    let clone = obstacleModels[type].clone();
    clone.userData.type = type;

    // scale each type
    if (type === "taxi") clone.scale.set(0.5, 0.5, 0.5);
    else if (type === "bus") clone.scale.set(1, 1, 1);
    else if (type === "lgv") clone.scale.set(0.8, 0.8, 0.8);
    else if (type === "bike") clone.scale.set(1, 1, 1);

    clone.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    clone.visible = false;
    environmentGroup.add(clone);
    obstaclePool.push(clone);
  }
  console.log("Obstacle pool initialized. Count:", obstaclePool.length);
}

function getObstacleFromPool() {
  for (let obs of obstaclePool) {
    if (!obs.visible) return obs;
  }
  return null;
}

// ================== SPAWN/UPDATE OBSTACLES ==================
function spawnObstacle() {
  if (!userCarLoaded || obstaclePool.length === 0) return;

  let obs = getObstacleFromPool();
  if (!obs) return;

  obs.visible = true;
  const lane = lanePositions[Math.floor(Math.random() * lanePositions.length)];
  let spawnZ = MTC.position.z - 100 - Math.random() * 50;
  obs.position.set(lane, 0.2, spawnZ);
  obs.rotation.y = Math.PI;

  // random speed
  obs.userData.speed = (22.222 + difficultyRamp) + Math.random() * 10;
  obstacles.push(obs);
}

function updateObstacles(dt) {
  for (let i = obstacles.length - 1; i >= 0; i--) {
    let obs = obstacles[i];
    if (!obs.visible) {
      obstacles.splice(i, 1);
      continue;
    }
    obs.position.z -= obs.userData.speed * dt;
    if (obs.position.z > MTC.position.z + 50) {
      obs.visible = false;
      obstacles.splice(i, 1);
    }
  }
}

// ================== COLLISIONS ==================
function checkCollisions() {
  if (!MTC) return;
  const carBox = new THREE.Box3().setFromObject(MTC).expandByScalar(0.3);

  for (let i = obstacles.length - 1; i >= 0; i--) {
    let obs = obstacles[i];
    if (!obs.visible) continue;
    let obsBox = new THREE.Box3().setFromObject(obs).expandByScalar(0.3);
    if (carBox.intersectsBox(obsBox)) {
      handleCollision();
      obs.visible = false;
      obstacles.splice(i, 1);
    }
  }
}

function handleCollision() {
  collisionCount++;
  totalCollisions++;
  console.log("Collision #", collisionCount);
  if (collisionCount < 3) {
    displayWarningIndicator();
  } else {
    triggerGameOver();
  }
}

// ================== WARNING INDICATOR ==================
function displayWarningIndicator() {
  const indicator = document.getElementById("warningIndicator");
  if (collisionCount === 1) {
    indicator.style.display = "block";
    indicator.classList.add("flashing");
  } else if (collisionCount === 2) {
    indicator.classList.remove("flashing");
    indicator.style.animation = "flash 0.5s infinite";
  }
}

// ================== GAME OVER ==================
function triggerGameOver() {
  if (gameOver) return;
  gameOver = true;
  cancelAnimationFrame(animationId);

  document.getElementById("speedometer").style.display = "none";
  document.getElementById("warningIndicator").style.display = "none";

  // Show final time
  document.getElementById("finalTime").textContent = formatTime(elapsedTime);

  // Orbit camera, then show the gameOver UI
  startCameraOrbit(() => {
    document.getElementById("gameOver").style.display = "block";
  });
}

// ================== GAME COMPLETE ==================
function handleGameCompletion() {
  if (gameCompleted) return;
  gameCompleted = true;
  cancelAnimationFrame(animationId);

  document.getElementById("speedometer").style.display = "none";
  document.getElementById("warningIndicator").style.display = "none";

  document.getElementById("completionTime").textContent = formatTime(elapsedTime);

  // Add some final stats text if you want
  let avgSpeed = (distance / elapsedTime) * 3.6; // m/s -> km/h
  document.getElementById("gameResultStats").textContent = `Collisions: ${totalCollisions}, Avg Speed: ${avgSpeed.toFixed(1)} km/h, Score: ${scoreboard}`;

  obstacles.forEach((o) => (o.visible = false));
  obstacles = [];

  // Leaderboard update after orbit
  startCameraOrbit(() => {
    updateLeaderboard();
    document.getElementById("gameComplete").style.display = "block";
  });
}

// ================== CAMERA ORBIT ==================
function startCameraOrbit(onComplete) {
  orbitActive = true;
  orbitStartTime = Date.now();

  function orbitStep() {
    const now = Date.now();
    const t = (now - orbitStartTime) / 2000; // 2 seconds orbit
    if (t < 1) {
      const angle = 2 * Math.PI * t;
      const radius = 15;
      const centerZ = MTC ? MTC.position.z : 0;
      camera.position.x = Math.cos(angle) * radius;
      camera.position.z = centerZ + Math.sin(angle) * radius;
      camera.position.y = 5 + 2 * Math.sin(t * Math.PI);
      if (MTC) camera.lookAt(MTC.position);
      requestAnimationFrame(orbitStep);
    } else {
      orbitActive = false;
      if (onComplete) onComplete();
    }
  }
  orbitStep();
}

// ================== LEADERBOARD ==================
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
    document.getElementById("nameInputContainer").style.display = "block";
    let submitBtn = document.getElementById("submitNameButton");
    submitBtn.replaceWith(submitBtn.cloneNode(true));
    submitBtn = document.getElementById("submitNameButton");
    submitBtn.addEventListener("click", () => {
      const name = document.getElementById("nameInput").value.trim() || "Anonymous";
      leaderboard.splice(position, 0, {
        name,
        time: elapsedTime,
        collisions: totalCollisions,
        score: scoreboard,
      });
      if (leaderboard.length > 10) {
        leaderboard.pop();
      }
      localStorage.setItem("leaderboard", JSON.stringify(leaderboard));
      displayLeaderboard();
      document.getElementById("nameInputContainer").style.display = "none";
      document.getElementById("gameComplete").style.display = "none";
    });
  } else {
    displayLeaderboard();
  }
  updateBestTimeDisplay();
}

function displayLeaderboard() {
  const list = document.getElementById("leaderboardList");
  list.innerHTML = "";
  leaderboard.forEach((entry, index) => {
    const li = document.createElement("li");
    let medal = "";
    if (index === 0) medal = "🥇";
    else if (index === 1) medal = "🥈";
    else if (index === 2) medal = "🥉";
    else medal = `${index + 1}.`;

    li.innerHTML = `<span>${medal} ${entry.name}</span>
                    <span>Time: ${formatTime(entry.time)}, Collisions: ${entry.collisions || 0}, Score: ${entry.score || 0}</span>`;
    list.appendChild(li);
  });
}

function updateBestTimeDisplay() {
  if (leaderboard.length > 0) {
    document.getElementById("bestTime").textContent = `Best Time: ${formatTime(leaderboard[0].time)}`;
  } else {
    document.getElementById("bestTime").textContent = "Best Time: N/A";
  }
}

// ================== HELPERS ==================
function formatTime(sec) {
  const mins = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 1000);
  return `${mins}:${s < 10 ? "0" : ""}${s}.${ms}`;
}

// ================== ANIMATION LOOP ==================
function animate() {
  if (gameOver || gameCompleted) return;
  animationId = requestAnimationFrame(animate);

  const now = Date.now();
  const dt = (now - previousTime) / 1000;
  previousTime = now;

  elapsedTime = (now - startTime) / 1000;
  document.getElementById("time").textContent = `Time: ${formatTime(elapsedTime)}`;

  // ramp
  difficultyRamp = elapsedTime * 0.2;

  distance += velocity * dt;
  scoreboard = Math.floor(distance);
  document.getElementById("distance").textContent = `Distance: ${distance.toFixed(1)} m`;
  document.getElementById("score").textContent = `Score: ${scoreboard}`;

  // check completion
  if (distance >= completionDistance) {
    handleGameCompletion();
    return;
  }

  // accelerate / decelerate
  if (accelerateInput) {
    velocity = Math.min(velocity + 5 * dt, maxVelocity);
  } else if (decelerateInput) {
    velocity = Math.max(velocity - 5 * dt, minVelocity);
  } else {
    // inertial approach to base
    if (velocity > baseVelocity) {
      velocity = Math.max(velocity - 2 * dt, baseVelocity);
    } else if (velocity < baseVelocity) {
      velocity = Math.min(velocity + 2 * dt, baseVelocity);
    }
  }

  document.getElementById("speedometer").textContent = `${(velocity * 3.6).toFixed(0)} km/h`;

  // move car forward
  if (MTC) {
    MTC.position.z -= velocity * dt;
  }

  // steering
  if (moveLeft) {
    MTC.position.x -= 0.05;
    MTC.rotation.z = 0.1;
  } else if (moveRight) {
    MTC.position.x += 0.05;
    MTC.rotation.z = -0.1;
  } else {
    MTC.rotation.z *= 0.9;
  }

  // update obstacles
  updateObstacles(dt);
  obstacleTimer += dt;
  if (obstacleTimer >= obstacleFrequency) {
    spawnObstacle();
    obstacleTimer = 0;
  }

  // check collisions
  checkCollisions();

  // camera follow if not orbiting
  if (!orbitActive) updateCamera();

  renderer.render(scene, camera);
}

function updateCamera() {
  const desiredPos = new THREE.Vector3(MTC.position.x, 5, MTC.position.z + 15);
  camera.position.lerp(desiredPos, 0.1);
  camera.lookAt(MTC.position.x, MTC.position.y, MTC.position.z);
}

// ================== JOYSTICK ==================
const joystickBase = document.getElementById("joystick-base");
const joystickKnob = document.getElementById("joystick-knob");
let joystickActive = false;
let joystickMaxDistance = 0;
let joystickX = 0;
let joystickY = 0;

function initJoystick() {
  joystickMaxDistance = joystickBase.offsetWidth / 2;

  joystickBase.addEventListener("touchstart", onJoystickStart, { passive: false });
  joystickBase.addEventListener("touchmove", onJoystickMove, { passive: false });
  joystickBase.addEventListener("touchend", onJoystickEnd, { passive: false });

  joystickBase.addEventListener("mousedown", onJoystickStart, { passive: false });
  document.addEventListener("mousemove", onJoystickMove, { passive: false });
  document.addEventListener("mouseup", onJoystickEnd, { passive: false });
}

function onJoystickStart(e) {
  e.preventDefault();
  joystickActive = true;
  joystickKnob.classList.add("active");
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
  joystickKnob.classList.remove("active");

  joystickKnob.style.transition = "transform 0.3s ease";
  joystickKnob.style.transform = "translate(0,0)";
  setTimeout(() => {
    joystickKnob.style.transition = "transform 0.1s ease";
    joystickX = 0;
    joystickY = 0;
  }, 300);

  accelerateInput = false;
  decelerateInput = false;
  moveLeft = false;
  moveRight = false;
}

function updateJoystick(e) {
  let rect = joystickBase.getBoundingClientRect();
  let clientX, clientY;
  if (e.touches) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  } else {
    clientX = e.clientX;
    clientY = e.clientY;
  }

  let x = clientX - rect.left - rect.width / 2;
  let y = clientY - rect.top - rect.height / 2;
  let dist = Math.sqrt(x * x + y * y);
  let angle = Math.atan2(y, x);

  let clampedDist = Math.min(dist, joystickMaxDistance);

  joystickX = (clampedDist * Math.cos(angle)) / joystickMaxDistance;
  joystickY = (clampedDist * Math.sin(angle)) / joystickMaxDistance;

  let knobX = joystickX * joystickMaxDistance * 0.6;
  let knobY = joystickY * joystickMaxDistance * 0.6;
  joystickKnob.style.transform = `translate(${knobX}px, ${knobY}px)`;

  const deadZone = 0.2;
  accelerateInput = joystickY > deadZone;
  decelerateInput = joystickY < -deadZone;
  moveLeft = joystickX < -deadZone;
  moveRight = joystickX > deadZone;
}

// ================== START / RESTART ==================
function startGame() {
  document.getElementById("start-screen").style.display = "none";
  document.getElementById("instructions").style.display = "none";

  startCameraAnimation();
}

function startCameraAnimation() {
  const startPos = new THREE.Vector3(0, 30, 100);
  const endPos = new THREE.Vector3(0, 5, 15);
  const duration = 1500;
  const camStart = Date.now();

  camera.position.copy(startPos);
  camera.lookAt(0, 0, 0);

  function camAnim() {
    let now = Date.now();
    let t = Math.min((now - camStart) / duration, 1);
    camera.position.lerpVectors(startPos, endPos, t);
    camera.lookAt(0, 0, 0);
    if (t < 1) {
      requestAnimationFrame(camAnim);
    } else {
      resetGameState();
      animate();
    }
  }
  camAnim();
}

function resetGameState() {
  collisionCount = 0;
  totalCollisions = 0;
  distance = 0;
  scoreboard = 0;
  velocity = baseVelocity;
  gameOver = false;
  gameCompleted = false;
  orbitActive = false;

  document.getElementById("gameOver").style.display = "none";
  document.getElementById("gameComplete").style.display = "none";
  document.getElementById("warningIndicator").style.display = "none";
  document.getElementById("warningIndicator").classList.remove("flashing");
  document.getElementById("warningIndicator").style.animation = "";

  // reset car
  if (MTC) {
    MTC.position.set(0, 1.1, 0);
    MTC.rotation.set(0, 0, 0);
  }

  // hide obstacles
  obstacles.forEach((obs) => (obs.visible = false));
  obstacles = [];

  obstacleTimer = 0;
  difficultyRamp = 0;

  previousTime = Date.now();
  startTime = previousTime;

  updateBestTimeDisplay();
}

function onRestart() {
  resetGameState();
  animate();
}

function onContinue() {
  window.location.href = "https://air.zone";
}

// ================== MAIN ==================
initScene();
loadModels();
setupEnvironment();
initJoystick();

// Hook up buttons
document.getElementById("play-button").addEventListener("click", startGame);
document.getElementById("restartButton").addEventListener("click", onRestart);
document.getElementById("continueLink").addEventListener("click", onContinue);
document.getElementById("restartButtonComplete").addEventListener("click", onRestart);
document.getElementById("continueLinkComplete").addEventListener("click", onContinue);

// Wait a few seconds for models, then create obstacle pool
setTimeout(() => {
  initObstaclePool();
}, 4000);

// Show leaderboard on load
displayLeaderboard();
updateBestTimeDisplay();