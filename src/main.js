// Import three.js and its modules
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as CANNON from 'cannon-es';

// ================== GLOBALS ==================
let scene, camera, renderer;
let environmentGroup;
let MTC; // user's car
let userCarBody;
let userCarLoaded = false;

let physicsWorld;
let obstacleModels = {}; // { taxi, bus, lgv, bike }
let obstaclePool = [];
let obstacleBodies = [];
let obstacles = [];

const obstacleTypes = ["taxi", "bus", "lgv", "bike"];
const maxObstacles = 10;

let lanePositions = [-2, 0, 2];

// Player inputs
let accelerateInput = false,
  decelerateInput = false,
  moveLeft = false,
  moveRight = false;

// Speeds
const baseVelocity = 6.944; // ~25 km/h
const minVelocity = 0.278;  // 1 km/h
const maxVelocity = 44.444; // 160 km/h

// Collisions, game states
let collisionCount = 0;
let maxCollisions = 5; // ALLOW 5 collisions before game over
let gameOver = false;
let gameCompleted = false;

// Distances, scoreboard
let distance = 0;
let scoreboard = 0;
let totalCollisions = 0;
let elapsedTime = 0;
let startTime = 0;
let previousTime = 0;
let animationId;

let obstacleFrequency = 2; // spawn every 2 seconds
let obstacleTimer = 0;
let difficultyRamp = 0;
const completionDistance = 2000;

// Orbit camera effect
let orbitActive = false;
let orbitStartTime = 0;

// Joystick
let joystickBase, joystickKnob;
let joystickActive = false;
let joystickMaxDistance = 0;
let joystickX = 0;
let joystickY = 0;

// Leaderboard
let leaderboard = JSON.parse(localStorage.getItem("leaderboard")) || [];

// Physics stepping
let physicsDeltaTime = 0;
const PHYSICS_STEP = 1 / 50;

// For tracking loaded models (4 obstacles + 1 car)
let obstaclesLoadedCount = 0;
const TOTAL_MODELS_TO_LOAD = obstacleTypes.length + 1;

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
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far = 100;
  scene.add(dirLight);

  window.addEventListener("resize", onWindowResize, false);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ================== PHYSICS SETUP ==================
function initPhysics() {
  physicsWorld = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.82, 0),
    broadphase: new CANNON.NaiveBroadphase(),
    allowSleep: true
  });
  physicsWorld.solver.iterations = 10;
  physicsWorld.defaultContactMaterial.friction = 0.3;

  // Create a static ground plane
  const groundBody = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Plane()
  });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  physicsWorld.addBody(groundBody);
}

// ================== LOAD MODELS ==================
function loadModels() {
  const loader = new GLTFLoader();

  // 1) User Car (MTC)
  loader.load(
    "/MTC.glb", // Make sure your file is exactly named "MTC.glb"
    (gltf) => {
      MTC = gltf.scene;
      MTC.scale.set(2.2, 2.2, 2.2);
      MTC.position.set(0, 1.1, 0);

      MTC.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      environmentGroup.add(MTC);
      userCarLoaded = true;

      // Car physics
      const halfExtents = new CANNON.Vec3(1, 1, 2);
      const carShape = new CANNON.Box(halfExtents);
      userCarBody = new CANNON.Body({
        mass: 1000,
        shape: carShape,
        position: new CANNON.Vec3(0, 1.1, 0),
        linearDamping: 0.3,
        angularDamping: 0.6
      });
      physicsWorld.addBody(userCarBody);

      userCarBody.addEventListener("collide", (evt) => {
        if (evt.body && evt.body.userData && evt.body.userData.isObstacle) {
          handleCollision();
        }
      });

      obstaclesLoadedCount++;
      maybeInitObstaclePool();
    },
    undefined,
    (error) => {
      console.error("Error loading MTC.glb:", error);
    }
  );

  // 2) Obstacles (4 types) — Make sure file names match exactly
  loadObstacleModel(loader, "/TAXI.glb", "taxi"); // "TAXI.glb"
  loadObstacleModel(loader, "/Bus.glb", "bus", (gltfScene) => {
    gltfScene.scale.set(3, 3, 3); // triple size
  });
  loadObstacleModel(loader, "/LGV.glb", "lgv");
  loadObstacleModel(loader, "/Bike.glb", "bike", (gltfScene) => {
    gltfScene.scale.set(2, 2, 2);
    gltfScene.rotation.y = Math.PI / 2; // rotate 90°
  });
}

function loadObstacleModel(loader, url, modelKey, onLoadCallback) {
  loader.load(
    url,
    (gltf) => {
      if (onLoadCallback) {
        onLoadCallback(gltf.scene);
      }
      obstacleModels[modelKey] = gltf.scene;
      console.log(`${modelKey} loaded successfully from ${url}.`);

      obstaclesLoadedCount++;
      maybeInitObstaclePool();
    },
    undefined,
    (error) => {
      console.error(`Error loading ${url}:`, error);
    }
  );
}

function maybeInitObstaclePool() {
  if (obstaclesLoadedCount >= TOTAL_MODELS_TO_LOAD) {
    console.log("All models loaded. Initializing obstacle pool...");
    initObstaclePool();
  }
}

// ================== ENVIRONMENT SETUP ==================
function setupEnvironment() {
  // Road
  const roadWidth = 6;
  const roadLength = 4000;
  const roadGeom = new THREE.PlaneGeometry(roadWidth, roadLength);
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const road = new THREE.Mesh(roadGeom, roadMat);
  road.rotation.x = -Math.PI / 2;
  road.receiveShadow = true;
  environmentGroup.add(road);

  // Lane markings (instanced)
  createLaneMarkingsInstanced(roadLength, lanePositions);

  // Side barriers
  const barrierHeight = 1.2;
  const barrierThickness = 0.2;
  const barrierGeom = new THREE.BoxGeometry(barrierThickness, barrierHeight, roadLength);
  const barrierMat = new THREE.MeshLambertMaterial({ color: 0xffffff });

  const barrierLeft = new THREE.Mesh(barrierGeom, barrierMat);
  barrierLeft.position.set(-roadWidth / 2 - barrierThickness / 2, barrierHeight / 2, 0);
  barrierLeft.castShadow = true;
  barrierLeft.receiveShadow = true;
  environmentGroup.add(barrierLeft);

  const barrierRight = new THREE.Mesh(barrierGeom, barrierMat);
  barrierRight.position.set(roadWidth / 2 + barrierThickness / 2, barrierHeight / 2, 0);
  barrierRight.castShadow = true;
  barrierRight.receiveShadow = true;
  environmentGroup.add(barrierRight);

  // Lights/lampposts
  const lamppostData = {
    poleGeom: new THREE.CylinderGeometry(0.05, 0.05, 4, 8),
    poleMat: new THREE.MeshLambertMaterial({ color: 0x555555 }),
    lampGeom: new THREE.SphereGeometry(0.2, 8, 8),
    lampMat: new THREE.MeshBasicMaterial({ color: 0xffffaa })
  };
  const tLightData = {
    poleGeom: new THREE.CylinderGeometry(0.06, 0.06, 3, 8),
    poleMat: new THREE.MeshLambertMaterial({ color: 0x444444 }),
    boxGeom: new THREE.BoxGeometry(0.4, 1, 0.4),
    boxMat: new THREE.MeshLambertMaterial({ color: 0x222222 }),
    bulbGeom: new THREE.SphereGeometry(0.1, 8, 8),
    redMat: new THREE.MeshBasicMaterial({ color: 0xff0000 }),
    yellowMat: new THREE.MeshBasicMaterial({ color: 0xffff00 }),
    greenMat: new THREE.MeshBasicMaterial({ color: 0x00ff00 })
  };

  // Place lampposts every 50m
  for (let z = -roadLength / 2; z < roadLength / 2; z += 50) {
    createLamppost(-roadWidth / 2 - 1, z, lamppostData);
    createLamppost(roadWidth / 2 + 1, z, lamppostData);
  }

  // Place traffic lights every 200m
  for (let z = -roadLength / 2; z < roadLength / 2; z += 200) {
    createTrafficLight(-roadWidth / 2 - 2, z, tLightData);
    createTrafficLight(roadWidth / 2 + 2, z, tLightData);
  }
}

function createLaneMarkingsInstanced(roadLength, lanes) {
  const spacing = 10;
  const lineLength = 1;
  const markerGeom = new THREE.PlaneGeometry(0.08, lineLength);
  markerGeom.rotateX(-Math.PI / 2);
  const markerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });

  const numMarkersPerLane = Math.floor(roadLength / spacing);
  const totalMarkers = numMarkersPerLane * lanes.length;

  const instanced = new THREE.InstancedMesh(markerGeom, markerMat, totalMarkers);
  let index = 0;
  for (let z = -roadLength / 2; z < roadLength / 2; z += spacing) {
    for (let laneX of lanes) {
      const dummy = new THREE.Object3D();
      dummy.position.set(laneX, 0.01, z);
      dummy.updateMatrix();
      instanced.setMatrixAt(index++, dummy.matrix);
    }
  }
  environmentGroup.add(instanced);
}

function createLamppost(x, z, data) {
  const pole = new THREE.Mesh(data.poleGeom, data.poleMat);
  pole.position.set(x, 2, z);
  pole.castShadow = true;
  environmentGroup.add(pole);

  const lamp = new THREE.Mesh(data.lampGeom, data.lampMat);
  lamp.position.set(x, 4, z);
  environmentGroup.add(lamp);

  const light = new THREE.PointLight(0xffffaa, 0.7, 10);
  light.position.set(x, 4, z);
  environmentGroup.add(light);
}

function createTrafficLight(x, z, data) {
  const pole = new THREE.Mesh(data.poleGeom, data.poleMat);
  pole.position.set(x, 1.5, z);
  pole.castShadow = true;
  environmentGroup.add(pole);

  const box = new THREE.Mesh(data.boxGeom, data.boxMat);
  box.position.set(x, 3, z);
  environmentGroup.add(box);

  const redBulb = new THREE.Mesh(data.bulbGeom, data.redMat);
  redBulb.position.set(0, 0.3, 0);
  box.add(redBulb);

  const yellowBulb = new THREE.Mesh(data.bulbGeom, data.yellowMat);
  yellowBulb.position.set(0, 0, 0);
  box.add(yellowBulb);

  const greenBulb = new THREE.Mesh(data.bulbGeom, data.greenMat);
  greenBulb.position.set(0, -0.3, 0);
  box.add(greenBulb);
}

// ================== OBSTACLE POOL ==================
function initObstaclePool() {
  console.log("Initializing obstacle pool...");
  for (let i = 0; i < maxObstacles; i++) {
    const type = obstacleTypes[i % obstacleTypes.length];
    const model = obstacleModels[type];
    if (!model) continue;

    const clone = model.clone();
    clone.userData.type = type;
    clone.userData.isObstacle = true;

    clone.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    clone.visible = false;
    environmentGroup.add(clone);
    obstaclePool.push(clone);

    // Create Cannon body
    const boundingBox = new THREE.Box3().setFromObject(clone);
    const size = new THREE.Vector3();
    boundingBox.getSize(size);

    const halfExtents = new CANNON.Vec3(size.x * 0.5, size.y * 0.5, size.z * 0.5);
    const shape = new CANNON.Box(halfExtents);
    const body = new CANNON.Body({
      mass: 600,
      shape: shape,
      linearDamping: 0.2,
      angularDamping: 0.4
    });
    body.userData = { isObstacle: true, type };
    physicsWorld.addBody(body);
    obstacleBodies.push(body);

    body.addEventListener("collide", (evt) => {
      if (evt.body === userCarBody) {
        handleCollision();
      }
    });
  }
  console.log("Obstacle pool created:", obstaclePool.length);
}

function getObstacleFromPool() {
  for (let i = 0; i < obstaclePool.length; i++) {
    if (!obstaclePool[i].visible) {
      return i;
    }
  }
  return -1;
}

// ================== SPAWN/UPDATE OBSTACLES ==================
function spawnObstacle() {
  if (!userCarLoaded || obstaclePool.length === 0) return;

  const poolIndex = getObstacleFromPool();
  if (poolIndex === -1) return;

  const obs = obstaclePool[poolIndex];
  const obsBody = obstacleBodies[poolIndex];

  obs.visible = true;
  const lane = lanePositions[Math.floor(Math.random() * lanePositions.length)];

  // Increase offset so obstacles spawn further behind the player
  const spawnZ = userCarBody.position.z - 150 - Math.random() * 100;

  obs.position.set(lane, 0.2, spawnZ);
  obs.rotation.set(0, Math.PI, 0);

  obsBody.position.set(lane, 0.2, spawnZ);
  obsBody.velocity.set(0, 0, 0);
  obsBody.angularVelocity.set(0, 0, 0);
  obsBody.quaternion.setFromEuler(0, Math.PI, 0);

  const obstacleSpeed = 22.222 + difficultyRamp + Math.random() * 10;
  obsBody.userData.speed = obstacleSpeed;

  obstacles.push({ mesh: obs, body: obsBody });
}

function updateObstacles(dt) {
  const frustum = new THREE.Frustum();
  const projScreenMatrix = new THREE.Matrix4();
  camera.updateMatrixWorld();
  projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projScreenMatrix);

  for (let i = obstacles.length - 1; i >= 0; i--) {
    const { mesh, body } = obstacles[i];

    // Remove if they pass a certain threshold in front
    if (body.position.z > userCarBody.position.z + 50) {
      mesh.visible = false;
      body.position.set(0, -1000, 0);
      obstacles.splice(i, 1);
      continue;
    }

    // If it's not visible in the frustum and has gone far enough, remove
    if (!frustum.intersectsObject(mesh)) {
      if (body.position.z > userCarBody.position.z + 100) {
        mesh.visible = false;
        body.position.set(0, -1000, 0);
        obstacles.splice(i, 1);
      }
    }
  }
}

// ================== COLLISIONS (WITH HEALTH BAR) ==================
function handleCollision() {
  if (gameOver) return;

  collisionCount++;
  totalCollisions++;
  console.log("Collision #", collisionCount);

  updateHealthBar();

  if (collisionCount >= maxCollisions) {
    triggerGameOver();
  } else {
    displayWarningIndicator();
  }
}

// Update the health bar from 100% down to 0% as collisions happen
function updateHealthBar() {
  const healthLeft = maxCollisions - collisionCount;
  const percentage = (healthLeft / maxCollisions) * 100;
  const bar = document.getElementById("healthBar");
  if (bar) {
    bar.style.width = percentage + "%";
  }
}

// ================== WARNING INDICATOR ==================
function displayWarningIndicator() {
  const indicator = document.getElementById("warningIndicator");
  indicator.style.display = "block";
  indicator.classList.add("flashing");
}

// ================== GAME OVER ==================
function triggerGameOver() {
  if (gameOver) return;
  gameOver = true;
  cancelAnimationFrame(animationId);

  document.getElementById("speedometer").style.display = "none";
  document.getElementById("warningIndicator").style.display = "none";
  document.getElementById("finalTime").textContent = formatTime(elapsedTime);

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
  const avgSpeed = (distance / elapsedTime) * 3.6;
  document.getElementById("gameResultStats").textContent =
    `Collisions: ${totalCollisions}, Avg Speed: ${avgSpeed.toFixed(1)} km/h, Score: ${scoreboard}`;

  obstacles.forEach(({ mesh, body }) => {
    mesh.visible = false;
    body.position.set(0, -1000, 0);
  });
  obstacles = [];

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
    const t = (now - orbitStartTime) / 2000;
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

// ================== JOYSTICK ==================
function initJoystick() {
  joystickBase = document.getElementById("joystick-base");
  joystickKnob = document.getElementById("joystick-knob");

  if (!joystickBase || !joystickKnob) return;

  joystickMaxDistance = joystickBase.offsetWidth / 2;

  // Clean up old listeners
  joystickBase.removeEventListener("touchstart", onJoystickStart);
  joystickBase.removeEventListener("touchmove", onJoystickMove);
  joystickBase.removeEventListener("touchend", onJoystickEnd);
  joystickBase.removeEventListener("mousedown", onJoystickStart);
  document.removeEventListener("mousemove", onJoystickMove);
  document.removeEventListener("mouseup", onJoystickEnd);

  // Add new listeners
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
  const rect = joystickBase.getBoundingClientRect();
  let clientX, clientY;
  if (e.touches) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  } else {
    clientX = e.clientX;
    clientY = e.clientY;
  }

  const x = clientX - rect.left - rect.width / 2;
  const y = clientY - rect.top - rect.height / 2;
  const dist = Math.sqrt(x * x + y * y);
  const angle = Math.atan2(y, x);

  const clampedDist = Math.min(dist, joystickMaxDistance);

  joystickX = (clampedDist * Math.cos(angle)) / joystickMaxDistance;
  joystickY = (clampedDist * Math.sin(angle)) / joystickMaxDistance;

  const knobX = joystickX * joystickMaxDistance * 0.6;
  const knobY = joystickY * joystickMaxDistance * 0.6;
  joystickKnob.style.transform = `translate(${knobX}px, ${knobY}px)`;

  const deadZone = 0.2;
  accelerateInput = joystickY > deadZone;
  decelerateInput = joystickY < -deadZone;
  moveLeft = joystickX < -deadZone;
  moveRight = joystickX > deadZone;
}

// ================== MAIN ANIMATION LOOP ==================
function animate() {
  if (gameOver || gameCompleted) {
    cancelAnimationFrame(animationId);
    return;
  }

  animationId = requestAnimationFrame(animate);

  const now = Date.now();
  const dt = (now - previousTime) / 1000;
  previousTime = now;

  // Fixed-step physics
  physicsDeltaTime += dt;
  while (physicsDeltaTime >= PHYSICS_STEP) {
    updatePhysics(PHYSICS_STEP);
    physicsDeltaTime -= PHYSICS_STEP;
  }

  updateVisuals(dt);

  // Spawn obstacles
  obstacleTimer += dt;
  if (obstacleTimer >= obstacleFrequency) {
    spawnObstacle();
    obstacleTimer = 0;
  }

  renderer.render(scene, camera);
}

function updatePhysics(dt) {
  physicsWorld.step(dt);

  if (userCarBody) {
    // Forward/back
    let currentVelZ = userCarBody.velocity.z;
    if (accelerateInput) {
      currentVelZ = Math.max(currentVelZ - 5, -maxVelocity);
    } else if (decelerateInput) {
      currentVelZ = Math.min(currentVelZ + 5, -minVelocity);
    } else {
      const baseZ = -baseVelocity;
      if (currentVelZ < baseZ) {
        currentVelZ = Math.min(currentVelZ + 2 * dt, baseZ);
      } else if (currentVelZ > baseZ) {
        currentVelZ = Math.max(currentVelZ - 2 * dt, baseZ);
      }
    }
    userCarBody.velocity.z = currentVelZ;

    // Left/Right
    if (moveLeft) {
      userCarBody.velocity.x = -5;
    } else if (moveRight) {
      userCarBody.velocity.x = 5;
    } else {
      // Dampen side velocity
      userCarBody.velocity.x *= 0.9;
      if (Math.abs(userCarBody.velocity.x) < 0.05) {
        userCarBody.velocity.x = 0;
      }
    }
  }

  // Update obstacle velocities
  obstacles.forEach(({ body }) => {
    body.velocity.z = body.userData.speed;
  });

  // Sync
  syncMeshesToBodies();
  updateObstacles(dt);
}

function updateVisuals(dt) {
  elapsedTime = (Date.now() - startTime) / 1000;
  document.getElementById("time").textContent = `Time: ${formatTime(elapsedTime)}`;

  difficultyRamp = elapsedTime * 0.2;

  if (userCarBody) {
    distance = Math.max(0, -userCarBody.position.z);
  }
  scoreboard = Math.floor(distance);

  document.getElementById("distance").textContent = `Distance: ${distance.toFixed(1)} m`;
  document.getElementById("score").textContent = `Score: ${scoreboard}`;

  if (distance >= completionDistance) {
    handleGameCompletion();
    return;
  }

  // Speedometer
  if (userCarBody) {
    const speedKmh = Math.abs(userCarBody.velocity.length()) * 3.6;
    document.getElementById("speedometer").textContent = `${speedKmh.toFixed(0)} km/h`;
  }

  // Car tilt
  if (MTC) {
    if (moveLeft) {
      MTC.rotation.z = 0.1;
    } else if (moveRight) {
      MTC.rotation.z = -0.1;
    } else {
      MTC.rotation.z *= 0.9;
    }
  }

  if (!orbitActive) updateCamera();
}

function syncMeshesToBodies() {
  if (MTC && userCarBody) {
    MTC.position.copy(userCarBody.position);
    MTC.quaternion.copy(userCarBody.quaternion);
  }

  obstaclePool.forEach((obs, i) => {
    if (!obs.visible) return;
    obs.position.copy(obstacleBodies[i].position);
    obs.quaternion.copy(obstacleBodies[i].quaternion);
  });
}

function updateCamera() {
  if (!userCarBody) return;
  const desiredPos = new THREE.Vector3(userCarBody.position.x, 5, userCarBody.position.z + 15);
  camera.position.lerp(desiredPos, 0.1);
  camera.lookAt(
    userCarBody.position.x,
    userCarBody.position.y,
    userCarBody.position.z
  );
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
    // ensure previous events are cleared by cloning
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
    document.getElementById("bestTime").textContent =
      `Best Time: ${formatTime(leaderboard[0].time)}`;
  } else {
    document.getElementById("bestTime").textContent = "Best Time: N/A";
  }
}

// ================== GAME CONTROLS ==================
function startGame() {
  // Hide start/instructions
  document.getElementById("start-screen").style.display = "none";
  document.getElementById("instructions").style.display = "none";
  // Begin a short camera animation, then reset game and animate
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
    const now = Date.now();
    const t = Math.min((now - camStart) / duration, 1);
    camera.position.lerpVectors(startPos, endPos, t);
    camera.lookAt(0, 0, 0);
    if (t < 1) {
      requestAnimationFrame(camAnim);
    } else {
      // Once the camera move is done, actually start the game
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
  gameOver = false;
  gameCompleted = false;
  orbitActive = false;

  document.getElementById("gameOver").style.display = "none";
  document.getElementById("gameComplete").style.display = "none";
  document.getElementById("warningIndicator").style.display = "none";
  document.getElementById("warningIndicator").classList.remove("flashing");
  document.getElementById("warningIndicator").style.animation = "";

  // Reset the health bar to 100%
  updateHealthBar(); // sets it to full

  // Offset car position so it starts well ahead of Z=0
  if (userCarBody) {
    userCarBody.position.set(0, 1.1, 20);
    userCarBody.velocity.set(0, 0, 0);
    userCarBody.angularVelocity.set(0, 0, 0);
    userCarBody.quaternion.set(0, 0, 0, 1);
  }
  if (MTC) {
    MTC.position.set(0, 1.1, 20);
    MTC.rotation.set(0, 0, 0);
  }

  obstacles.forEach(({ mesh, body }) => {
    mesh.visible = false;
    body.position.set(0, -1000, 0);
  });
  obstacles = [];

  obstacleTimer = 0;
  difficultyRamp = 0;

  previousTime = Date.now();
  startTime = previousTime;

  updateBestTimeDisplay();
}

// ================== HELPERS ==================
function formatTime(sec) {
  const mins = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 1000);
  return `${mins}:${s < 10 ? "0" : ""}${s}.${ms}`;
}

// ================== INITIALIZATION ==================
function init() {
  initScene();
  initPhysics();
  loadModels(); // load .glb models (make sure filenames match)
  setupEnvironment();
  initJoystick();

  // Hook up UI
  document.getElementById("play-button").addEventListener("click", startGame);
  document.getElementById("restartButton").addEventListener("click", resetGameState);
  document.getElementById("continueLink").addEventListener("click", () => {
    window.location.href = "https://air.zone"; // or your desired link
  });
  document.getElementById("restartButtonComplete").addEventListener("click", resetGameState);
  document.getElementById("continueLinkComplete").addEventListener("click", () => {
    window.location.href = "https://air.zone"; // or your desired link
  });

  // Show initial leaderboard if any
  displayLeaderboard();
  updateBestTimeDisplay();
}

// Initialize once DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  init();
});
