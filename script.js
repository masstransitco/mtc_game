/*********************************************************************
 * script.js
 * 
 * Enhanced Three.js mini-game (Hong Kong-inspired environment),
 * with added obstacles (Bus, LGV, Bike), neon signs, lampposts,
 * traffic lights, basic camera orbit on Game Over/Completion,
 * extended distance (2000m), and a restyled leaderboard.
 *********************************************************************/

// ================== GLOBAL STATE & VARIABLES ==================
let scene, camera, renderer;
let environmentGroup;
let MTC; // The user’s car
let userCarLoaded = false;

// We’ll store all obstacle models (taxi, bus, lgv, bike) in a dictionary
let obstacleModels = {};
let obstacleTypes = ["taxi", "bus", "lgv", "bike"];
let obstacles = [];
let obstaclePool = [];
const maxObstacles = 12; // Increase slightly for more variety

// 5-lane positions by default, but you can reduce or expand
let lanePositions = [-4, -2, 0, 2, 4];

// Basic velocity & game metrics
const baseVelocity = 6.944;  // ~25 km/h
const minVelocity = 0.278;   // ~1 km/h
const maxVelocity = 44.444;  // ~160 km/h
let velocity = baseVelocity;

let accelerateInput = false;
let decelerateInput = false;
let moveLeft = false;
let moveRight = false;

let gameOver = false;
let gameCompleted = false;
let collisionCount = 0;

let distance = 0;      // meters
let elapsedTime = 0;   // seconds
let startTime = 0;     // ms
let previousTime = 0;  // ms
let animationId;

let scoreboard = 0;    // 1 point per meter
let totalCollisions = 0; // track collisions

// Leaderboard stored in localStorage
let leaderboard = JSON.parse(localStorage.getItem("leaderboard")) || [];

// Obstacle spawn logic
let obstacleFrequency = 2; // every 2 seconds
let obstacleTimer = 0;
let difficultyRamp = 0; // speeds up obstacles over time

// Extended distance for completion
const completionDistance = 2000; // from 1000m to 2000m

// For camera orbit at end
let orbitActive = false;
let orbitStartTime = 0;

// ================== SETUP SCENE, CAMERA, RENDERER ==================
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

  // Basic lighting (stronger for a city vibe)
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 30, 10);
  dirLight.castShadow = true;
  scene.add(dirLight);

  // Extra point light for "neon" effect
  const neonLight = new THREE.PointLight(0xff00ff, 0.3, 200);
  neonLight.position.set(0, 10, -50);
  scene.add(neonLight);

  window.addEventListener("resize", onWindowResize, false);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ================== LOAD MODELS (User Car & Obstacles) ==================
function loadModels() {
  const loader = new THREE.GLTFLoader();

  // 1) User Car (MTC)
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
      console.log("MTC Car loaded.");
    },
    undefined,
    (err) => {
      console.error("Error loading mtc.glb:", err);
    }
  );

  // 2) Taxi
  loader.load(
    "taxi.glb",
    (gltf) => {
      obstacleModels.taxi = gltf.scene;
      console.log("Taxi loaded.");
    },
    undefined,
    (err) => console.error("Error loading taxi.glb:", err)
  );

  // 3) Bus
  loader.load(
    "Bus.glb",
    (gltf) => {
      obstacleModels.bus = gltf.scene;
      console.log("Bus loaded.");
    },
    undefined,
    (err) => console.error("Error loading Bus.glb:", err)
  );

  // 4) LGV
  loader.load(
    "LGV.glb",
    (gltf) => {
      obstacleModels.lgv = gltf.scene;
      console.log("LGV loaded.");
    },
    undefined,
    (err) => console.error("Error loading LGV.glb:", err)
  );

  // 5) Bike
  loader.load(
    "Bike.glb",
    (gltf) => {
      obstacleModels.bike = gltf.scene;
      console.log("Bike loaded.");
    },
    undefined,
    (err) => console.error("Error loading Bike.glb:", err)
  );
}

// ================== ENVIRONMENT (Road, Buildings, etc.) ==================
function setupEnvironment() {
  // Road
  const roadWidth = 12;
  const roadLength = 4000; // bigger for city vibe
  const roadGeom = new THREE.PlaneGeometry(roadWidth, roadLength);
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const road = new THREE.Mesh(roadGeom, roadMat);
  road.rotation.x = -Math.PI / 2;
  road.receiveShadow = true;
  environmentGroup.add(road);

  // Lane Markers
  const markerSpacing = 15;
  const markerLength = 1;
  for (let z = -roadLength / 2; z < roadLength / 2; z += markerSpacing) {
    lanePositions.forEach((laneX) => {
      const markerGeom = new THREE.BoxGeometry(0.1, 0.01, markerLength);
      const markerMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const marker = new THREE.Mesh(markerGeom, markerMat);
      marker.position.set(laneX, 0.01, z);
      marker.rotation.x = -Math.PI / 2;
      environmentGroup.add(marker);
    });
  }

  // Basic "Hong Kong" building placeholders on either side
  // We'll create random boxes with neon textures or emissive materials
  const buildingCount = 20;
  for (let i = 0; i < buildingCount; i++) {
    // random x offset: left side or right side
    const leftSide = Math.random() < 0.5;
    const baseX = leftSide ? -roadWidth * 1.5 : roadWidth * 1.5;

    // random z along the road length
    const randomZ = THREE.MathUtils.randFloat(-roadLength / 2, roadLength / 2);

    const bWidth = THREE.MathUtils.randFloat(2, 4);
    const bHeight = THREE.MathUtils.randFloat(10, 20);
    const bDepth = THREE.MathUtils.randFloat(2, 4);

    const buildingGeom = new THREE.BoxGeometry(bWidth, bHeight, bDepth);
    // Emissive or neon sign approach
    const signColor = new THREE.Color(
      "hsl(" + Math.floor(Math.random() * 360) + ", 100%, 50%)"
    );
    const buildingMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      emissive: signColor,
      emissiveIntensity: 0.2,
    });
    const building = new THREE.Mesh(buildingGeom, buildingMat);
    building.castShadow = true;
    building.receiveShadow = true;
    building.position.set(baseX, bHeight / 2, randomZ);
    environmentGroup.add(building);
  }

  // Add lampposts along the edges
  const lamppostSpacing = 30;
  for (let z = -roadLength / 2; z < roadLength / 2; z += lamppostSpacing) {
    // One lamppost on left, one on right
    createLamppost(-roadWidth / 2 - 1, z);
    createLamppost(roadWidth / 2 + 1, z);
  }

  // Add traffic lights near the road edges, spaced out
  const trafficLightSpacing = 200;
  for (let z = -roadLength / 2; z < roadLength / 2; z += trafficLightSpacing) {
    createTrafficLight(-roadWidth / 2 - 2, z);
    createTrafficLight(roadWidth / 2 + 2, z);
  }
}

// Helper to create a lamppost
function createLamppost(x, z) {
  const postGeom = new THREE.CylinderGeometry(0.05, 0.05, 4, 8);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x555555 });
  const post = new THREE.Mesh(postGeom, postMat);
  post.position.set(x, 2, z);
  post.castShadow = true;
  environmentGroup.add(post);

  // Light at top
  const lampLightGeom = new THREE.SphereGeometry(0.2, 8, 8);
  const lampLightMat = new THREE.MeshBasicMaterial({ color: 0xffe080 });
  const lampLight = new THREE.Mesh(lampLightGeom, lampLightMat);
  lampLight.position.set(x, 4, z);
  environmentGroup.add(lampLight);

  // Actual light
  const lampPointLight = new THREE.PointLight(0xffe080, 0.8, 10);
  lampPointLight.position.set(x, 4, z);
  environmentGroup.add(lampPointLight);
}

// Helper to create a traffic light
function createTrafficLight(x, z) {
  // Post
  const postGeom = new THREE.CylinderGeometry(0.07, 0.07, 3, 8);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x444444 });
  const post = new THREE.Mesh(postGeom, postMat);
  post.position.set(x, 1.5, z);
  post.castShadow = true;
  environmentGroup.add(post);

  // Light box
  const boxGeom = new THREE.BoxGeometry(0.4, 1, 0.4);
  const boxMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const box = new THREE.Mesh(boxGeom, boxMat);
  box.position.set(x, 3, z);
  environmentGroup.add(box);

  // Red / Yellow / Green bulbs
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
  // We only init once all models are loaded. Check if we have them:
  let allLoaded = obstacleTypes.every((type) => obstacleModels[type] != null);
  if (!allLoaded) {
    console.warn("Not all obstacle models loaded yet. Retrying in 2s...");
    setTimeout(() => {
      initObstaclePool();
    }, 2000);
    return;
  }

  // For variety, we create a certain number of each
  for (let i = 0; i < maxObstacles; i++) {
    // pick a random type
    let type = obstacleTypes[i % obstacleTypes.length];
    let modelClone = obstacleModels[type].clone();
    modelClone.userData.type = type;
    // scale them differently
    if (type === "taxi") modelClone.scale.set(0.5, 0.5, 0.5);
    if (type === "bus") modelClone.scale.set(1, 1, 1);
    if (type === "lgv") modelClone.scale.set(0.8, 0.8, 0.8);
    if (type === "bike") modelClone.scale.set(1, 1, 1);

    modelClone.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    modelClone.visible = false;
    environmentGroup.add(modelClone);
    obstaclePool.push(modelClone);
  }
  console.log("Obstacle pool initialized with models:", obstaclePool.length);
}

function getObstacleFromPool() {
  for (let obs of obstaclePool) {
    if (!obs.visible) return obs;
  }
  return null;
}

// ================== SPAWN & UPDATE OBSTACLES ==================
function spawnObstacle() {
  if (!userCarLoaded || obstaclePool.length === 0) return;

  let obs = getObstacleFromPool();
  if (!obs) return;

  obs.visible = true;
  // random lane
  const lane = lanePositions[Math.floor(Math.random() * lanePositions.length)];
  const spawnZ = MTC.position.z - 120 - Math.random() * 80; // in front
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
    // remove if it goes too far behind
    if (obs.position.z > MTC.position.z + 50) {
      obs.visible = false;
      obstacles.splice(i, 1);
    }
  }
}

// ================== COLLISIONS ==================
function checkCollisions() {
  if (!MTC) return;

  let carBox = new THREE.Box3().setFromObject(MTC).expandByScalar(0.3);
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

  // Final time
  document.getElementById("finalTime").textContent = formatTime(elapsedTime);

  // Initiate camera orbit, then show the gameOver UI after
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

  // Let’s store some stats for the scoreboard
  // E.g., collisions, avg speed = distance / time
  let averageSpeed = distance / elapsedTime; // m/s
  averageSpeed *= 3.6; // convert to km/h
  const resultLine = document.getElementById("gameResultStats");
  resultLine.textContent = `Collisions: ${totalCollisions}, Avg Speed: ${averageSpeed.toFixed(
    1
  )} km/h, Final Score: ${scoreboard}`;

  // Clear obstacles
  obstacles.forEach((o) => (o.visible = false));
  obstacles = [];

  // Update & show leaderboard after camera orbit
  startCameraOrbit(() => {
    updateLeaderboard();
    document.getElementById("gameComplete").style.display = "block";
  });
}

// ================== CAMERA ORBIT ANIMATION ==================
function startCameraOrbit(onComplete) {
  orbitActive = true;
  orbitStartTime = Date.now();

  function orbitStep() {
    const now = Date.now();
    const t = (now - orbitStartTime) / 2000; // 2-second orbit
    if (t < 1) {
      // do a 360 * t orbit around the car
      const angle = 2 * Math.PI * t; // from 0 to 2π
      const radius = 15;
      const centerZ = MTC ? MTC.position.z : 0;
      camera.position.x = Math.cos(angle) * radius;
      camera.position.z = centerZ + Math.sin(angle) * radius;
      camera.position.y = 8 + 3 * Math.sin(t * Math.PI); // small up/down
      if (MTC) camera.lookAt(MTC.position.x, MTC.position.y, MTC.position.z);
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
  // We’ll store the best times or final stats
  // For this example, we store the time only. You could store collisions, etc.
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
    const submitButton = document.getElementById("submitNameButton");
    // Clear old listeners
    submitButton.replaceWith(submitButton.cloneNode(true));
    const newSubmit = document.getElementById("submitNameButton");
    newSubmit.addEventListener("click", () => {
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

    // Show collisions, time, final score
    const timeStr = formatTime(entry.time);
    li.innerHTML = `<span>${medal} ${entry.name}</span>
                    <span>Time: ${timeStr}, Collisions: ${entry.collisions || 0}, Score: ${entry.score || 0}</span>`;
    list.appendChild(li);
  });
}

function updateBestTimeDisplay() {
  if (leaderboard.length > 0) {
    document.getElementById("bestTime").textContent = `Best Time: ${formatTime(
      leaderboard[0].time
    )}`;
  } else {
    document.getElementById("bestTime").textContent = `Best Time: N/A`;
  }
}

// ================== FORMAT TIME ==================
function formatTime(s) {
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 1000);
  return `${mins}:${secs < 10 ? "0" : ""}${secs}.${ms}`;
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

  // difficulty ramp
  difficultyRamp = elapsedTime * 0.2;

  // distance & scoreboard
  distance += velocity * dt;
  scoreboard = Math.floor(distance);
  document.getElementById("distance").textContent = `Distance: ${distance.toFixed(1)} m`;
  document.getElementById("score").textContent = `Score: ${scoreboard}`;

  // check completion
  if (distance >= completionDistance) {
    handleGameCompletion();
    return;
  }

  // Accel/Decel
  if (accelerateInput) {
    velocity = Math.min(velocity + 5 * dt, maxVelocity);
  } else if (decelerateInput) {
    velocity = Math.max(velocity - 5 * dt, minVelocity);
  } else {
    // mild inertia to base velocity
    if (velocity > baseVelocity) {
      velocity = Math.max(velocity - 2 * dt, baseVelocity);
    } else if (velocity < baseVelocity) {
      velocity = Math.min(velocity + 2 * dt, baseVelocity);
    }
  }

  // speedometer
  document.getElementById("speedometer").textContent = `${(velocity * 3.6).toFixed(0)} km/h`;

  // move the car forward
  if (MTC) {
    MTC.position.z -= velocity * dt;
  }

  // L-R steering
  if (moveLeft) {
    MTC.position.x -= 0.05;
    MTC.rotation.z = 0.1;
  } else if (moveRight) {
    MTC.position.x += 0.05;
    MTC.rotation.z = -0.1;
  } else {
    MTC.rotation.z *= 0.9;
  }

  // obstacles
  updateObstacles(dt);
  obstacleTimer += dt;
  if (obstacleTimer >= obstacleFrequency) {
    spawnObstacle();
    obstacleTimer = 0;
  }

  // collisions
  checkCollisions();

  // camera
  updateCamera();

  renderer.render(scene, camera);
}

function updateCamera() {
  if (!MTC) return;
  if (orbitActive) return; // If orbit is active, skip normal follow

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

  // reset knob
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
  let clientX, clientY;
  const rect = joystickBase.getBoundingClientRect();

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

// ================== START / RESTART ==================
function startGame() {
  document.getElementById("start-screen").style.display = "none";
  // Hide instructions or show them if you want
  document.getElementById("instructions").style.display = "none";

  startCameraAnimation();
}

function startCameraAnimation() {
  const startPos = new THREE.Vector3(0, 30, 100);
  const endPos = new THREE.Vector3(0, 5, 15);
  const duration = 1500;
  const startTimeCam = Date.now();

  // quick manual approach
  camera.position.copy(startPos);
  camera.lookAt(0, 0, 0);

  function animCam() {
    let now = Date.now();
    let t = Math.min((now - startTimeCam) / duration, 1);
    camera.position.lerpVectors(startPos, endPos, t);
    camera.lookAt(0, 0, 0);
    if (t < 1) {
      requestAnimationFrame(animCam);
    } else {
      resetGameState();
      animate();
    }
  }
  animCam();
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

  // reset user car
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

// ================== MAIN ENTRY ==================
initScene();
loadModels();
setupEnvironment();
initJoystick();

// Buttons
document.getElementById("play-button").addEventListener("click", startGame);
document.getElementById("restartButton").addEventListener("click", onRestart);
document.getElementById("continueLink").addEventListener("click", onContinue);
document.getElementById("restartButtonComplete").addEventListener("click", onRestart);
document.getElementById("continueLinkComplete").addEventListener("click", onContinue);

// Wait a few seconds for obstacle models to load, then create the pool
setTimeout(() => {
  initObstaclePool();
}, 4000);

// Show leaderboard on load
displayLeaderboard();
updateBestTimeDisplay();