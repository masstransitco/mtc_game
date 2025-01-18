// Import three.js and its modules
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as CANNON from 'cannon-es';

// ================== GLOBALS ==================
let scene, camera, renderer;
let environmentGroup;
let MTC; // User's car mesh
let userCarBody;
let userCarLoaded = false;

let physicsWorld;
let obstacleModels = {}; // Loaded obstacle models: { taxi, bus, lgv }
let obstaclePool = [];
let obstacleBodies = [];
let obstacles = [];

const obstacleTypes = ["taxi", "bus", "lgv"];
const maxObstacles = 3; 

// Example lane positions in X
let lanePositions = [-2, 0, 2];

// Player inputs (updated to match “pull joystick backward => move forward”)
let accelerateInput = false;
let decelerateInput = false;
let moveLeft = false;
let moveRight = false;

// Speeds (Car and obstacles move in +Z)
const baseVelocity = 6.944; // ~25 km/h
const minVelocity = 0.278;  // ~1 km/h
const maxVelocity = 44.444; // ~160 km/h

// Collisions, game states
let collisionCount = 0;
let maxCollisions = 5;
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

// Obstacle spawning
let obstacleFrequency = 3; // Spawn every 3 seconds (tweak as needed)
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
const PHYSICS_STEP = 1 / 60;

// For tracking loaded models
let obstaclesLoadedCount = 0;
const TOTAL_MODELS_TO_LOAD = obstacleTypes.length + 1; // 3 obstacles + 1 user car

// Invulnerability after game start
let invulnerable = true;
const invulnerabilityDuration = 3000; // 3 seconds

// ================== CRITICAL FUNCTIONS ==================

// Safely get an index from the obstacle pool
function getObstacleFromPool() {
  for (let i = 0; i < obstaclePool.length; i++) {
    if (!obstaclePool[i].visible) {
      return i;
    }
  }
  return -1;
}

function maybeInitObstaclePool() {
  if (obstaclesLoadedCount >= TOTAL_MODELS_TO_LOAD) {
    console.log("All models loaded. Initializing obstacle pool...");
    initObstaclePool();
  }
}

function createFallbackModel(type) {
  const geometries = {
    taxi: new THREE.BoxGeometry(2, 1, 4),
    bus: new THREE.BoxGeometry(3, 2, 7),
    lgv: new THREE.BoxGeometry(2.5, 2, 5),
    default: new THREE.BoxGeometry(2, 1, 4)
  };

  const materials = {
    taxi: new THREE.MeshLambertMaterial({ color: 0xffff00 }),
    bus: new THREE.MeshLambertMaterial({ color: 0x0000ff }),
    lgv: new THREE.MeshLambertMaterial({ color: 0xff0000 }),
    default: new THREE.MeshLambertMaterial({ color: 0x808080 })
  };

  const geometry = geometries[type] || geometries.default;
  const material = materials[type] || materials.default;
  
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  if (mesh.geometry) {
    mesh.geometry.computeBoundingSphere();
  }
  
  return mesh;
}

function handleModelLoadError(type) {
  console.log(`Using fallback for ${type}`);
  const fallbackModel = createFallbackModel(type);
  obstacleModels[type] = fallbackModel;
  obstaclesLoadedCount++;
  maybeInitObstaclePool();
}

// ================== LOADING MODELS ==================
function loadModels() {
  const loader = new GLTFLoader();

  // ======= Load user car (MTC) =======
  loader.load(
    "/MTC.glb",
    (gltf) => {
      try {
        MTC = gltf.scene;
        MTC.scale.set(2.2, 2.2, 2.2);

        // We'll compute the bounding box to ensure we place the car body properly
        // We won't set position until after we compute bounding box
        MTC.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.geometry) {
              child.geometry.computeBoundingSphere();
            }
          }
        });

        environmentGroup.add(MTC);

        // We'll set up the user car after we know boundingBox
        const boundingBox = new THREE.Box3().setFromObject(MTC);
        const size = new THREE.Vector3();
        boundingBox.getSize(size);
        // Typically, we want the bottom of the car at y=0. If pivot is at the center,
        // y=1.1 might be correct, or we can do half the height. We'll do something like:
        const halfHeight = size.y * 0.5;

        // Car physics body
        const halfExtents = new CANNON.Vec3(size.x * 0.5, size.y * 0.5, size.z * 0.5);
        const carShape = new CANNON.Box(halfExtents);

        userCarBody = new CANNON.Body({
          mass: 1000,
          shape: carShape,
          // Place the bottom of the shape on the ground plane => y = halfHeight
          position: new CANNON.Vec3(0, halfHeight, 0),
          linearDamping: 0.3,
          angularDamping: 0.6
        });
        userCarBody.fixedRotation = true;
        userCarBody.updateMassProperties();
        physicsWorld.addBody(userCarBody);

        // Keep track in code
        MTC.position.set(0, halfHeight, 0);

        userCarBody.addEventListener("collide", (evt) => {
          if (evt.body && evt.body.userData && evt.body.userData.isObstacle && !invulnerable) {
            handleCollision();
          }
        });

        userCarLoaded = true;
        obstaclesLoadedCount++;
        maybeInitObstaclePool();
      } catch (error) {
        console.error("Error processing MTC model:", error);
        // Fallback
        MTC = createFallbackModel('taxi');
        environmentGroup.add(MTC);
        userCarLoaded = true;
        obstaclesLoadedCount++;
        maybeInitObstaclePool();
      }
    },
    undefined,
    (error) => {
      console.error("Error loading MTC.glb:", error);
      // fallback
      MTC = createFallbackModel('taxi');
      environmentGroup.add(MTC);
      userCarLoaded = true;
      obstaclesLoadedCount++;
      maybeInitObstaclePool();
    }
  );

  function loadObstacleModel(url, modelKey, onLoadCallback) {
    loader.load(
      url,
      (gltf) => {
        try {
          if (onLoadCallback) onLoadCallback(gltf.scene);
          gltf.scene.traverse((child) => {
            if (child.isMesh && child.geometry) {
              child.geometry.computeBoundingSphere();
            }
          });
          obstacleModels[modelKey] = gltf.scene;
          console.log(`${modelKey} loaded successfully from ${url}`);
        } catch (error) {
          console.error(`Error processing ${modelKey} model:`, error);
          handleModelLoadError(modelKey);
          return;
        }
        obstaclesLoadedCount++;
        maybeInitObstaclePool();
      },
      undefined,
      (error) => {
        console.error(`Error loading ${url}:`, error);
        handleModelLoadError(modelKey);
      }
    );
  }

  // Load obstacles
  loadObstacleModel("/TAXI.glb", "taxi");
  loadObstacleModel("/Bus.glb", "bus", (scene) => {
    scene.scale.set(3, 3, 3);
  });
  loadObstacleModel("/LGV.glb", "lgv");
}

// ================== SCENE & PHYSICS SETUP ==================
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1C262D);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
  // Start behind the car (since the car is at z=0)
  camera.position.set(0, 5, -15);

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
  dirLight.position.set(10, 20, -10);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 512;
  dirLight.shadow.mapSize.height = 512;
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far = 200;
  scene.add(dirLight);

  window.addEventListener("resize", onWindowResize, false);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function initPhysics() {
  physicsWorld = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.82, 0),
    broadphase: new CANNON.NaiveBroadphase(),
    allowSleep: true
  });
  physicsWorld.solver.iterations = 10;
  physicsWorld.defaultContactMaterial.friction = 0.6; 

  // Static ground (plane)
  const groundBody = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Plane()
  });
  // Orient it so +Y is up
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  physicsWorld.addBody(groundBody);
}

// ================== ENVIRONMENT & OBSTACLES ==================
function setupEnvironment() {
  // Road
  const roadWidth = 6;
  const roadLength = 2000;
  const roadGeom = new THREE.PlaneGeometry(roadWidth, roadLength);
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const road = new THREE.Mesh(roadGeom, roadMat);
  road.rotation.x = -Math.PI / 2;
  road.receiveShadow = true;
  environmentGroup.add(road);

  // Lane markings
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
  // Center road from -roadLength/2 to +roadLength/2
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

// Initialize the obstacle pool once all models are loaded
function initObstaclePool() {
  console.log("Initializing obstacle pool...");
  for (let i = 0; i < maxObstacles; i++) {
    const type = obstacleTypes[i % obstacleTypes.length];
    const model = obstacleModels[type];
    if (!model) {
      console.warn(`Model for obstacle type '${type}' is not loaded. Skipping.`);
      continue;
    }

    const clone = model.clone(true);
    clone.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.userData.isObstacle = true;
      }
    });

    clone.visible = false;
    environmentGroup.add(clone);
    obstaclePool.push(clone);

    // Cannon body
    const boundingBox = new THREE.Box3().setFromObject(clone);
    const size = new THREE.Vector3();
    boundingBox.getSize(size);

    const halfExtents = new CANNON.Vec3(size.x * 0.5, size.y * 0.5, size.z * 0.5);
    const body = new CANNON.Body({
      mass: 500,
      shape: new CANNON.Box(halfExtents),
      linearDamping: 0.3,
      angularDamping: 0.8
    });
    body.fixedRotation = true;
    body.updateMassProperties();
    body.userData = { isObstacle: true, type };
    physicsWorld.addBody(body);
    obstacleBodies.push(body);

    clone.userData.physicsBody = body;
    body.addEventListener("collide", (evt) => {
      if (evt.body === userCarBody && !invulnerable) {
        handleCollision();
      }
    });
  }
  console.log("Obstacle pool created:", obstaclePool.length);
}

// ================== SPAWN & UPDATE OBSTACLES ==================
function spawnObstacle() {
  if (!userCarLoaded || obstaclePool.length === 0) return;

  const poolIndex = getObstacleFromPool();
  if (poolIndex === -1) return;

  const obs = obstaclePool[poolIndex];
  const obsBody = obstacleBodies[poolIndex];
  if (!obs || !obsBody) return;

  // Decide if spawning in front or behind user
  const userZ = userCarBody.position.z;
  const spawnBehind = Math.random() < 0.5; 
  // 50% chance behind, 50% in front (tweak as desired)

  let lane = lanePositions[Math.floor(Math.random() * lanePositions.length)];
  let spawnZ = 0;

  if (spawnBehind) {
    // spawn behind at random distance
    spawnZ = userZ - (50 + Math.random() * 50);
    // behind obstacles have higher speed to catch user
  } else {
    // spawn in front
    spawnZ = userZ + (50 + Math.random() * 100);
    // front obstacles have slower speed so user can catch them
  }

  obs.visible = true;
  obs.position.set(lane, 0.2, spawnZ);
  obs.rotation.set(0, 0, 0);

  obsBody.position.set(lane, 0.2, spawnZ);
  obsBody.velocity.set(0, 0, 0);
  obsBody.angularVelocity.set(0, 0, 0);
  obsBody.quaternion.setFromEuler(0, 0, 0);

  // If behind => higher speed, if ahead => slower speed
  let obstacleSpeed;
  if (spawnBehind) {
    // user is ~ baseVelocity => ~25 km/h
    // behind obstacle: maybe 30~40 km/h so it can catch up
    obstacleSpeed = 8.33 + difficultyRamp + Math.random() * 5; 
  } else {
    // in front obstacle: maybe 10~20 km/h so user can catch up
    obstacleSpeed = 2.77 + difficultyRamp + Math.random() * 5; 
  }
  obsBody.userData.speed = obstacleSpeed;

  // They all move in +Z direction
  obsBody.velocity.z = obstacleSpeed;

  obstacles.push({ mesh: obs, body: obsBody });
}

function updateObstacles(dt) {
  // Instead of frustum-based culling (which can cause boundingSphere issues
  // on non-mesh objects), let's do a simple positional check:
  // If the obstacle is too far from the user, remove it.

  const userZ = userCarBody.position.z;
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const { mesh, body } = obstacles[i];
    if (!mesh || !body) {
      obstacles.splice(i, 1);
      continue;
    }
    // If obstacle is way behind or way ahead the user
    if (body.position.z > userZ + 2000 || body.position.z < userZ - 2000) {
      // recycle
      mesh.visible = false;
      body.position.set(0, -1000, 0);
      obstacles.splice(i, 1);
    }
  }
}

// ================== COLLISIONS ==================
function handleCollision() {
  if (gameOver || invulnerable) return;

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

function updateHealthBar() {
  const healthLeft = maxCollisions - collisionCount;
  const percentage = Math.max((healthLeft / maxCollisions) * 100, 0);
  const bar = document.getElementById("healthBar");
  if (bar) {
    bar.style.width = percentage + "%";
  }
}

function displayWarningIndicator() {
  const indicator = document.getElementById("warningIndicator");
  if (indicator) {
    indicator.style.display = "block";
    indicator.classList.add("flashing");
    indicator.addEventListener('animationend', () => {
      indicator.classList.remove("flashing");
    }, { once: true });
  }
}

// ================== GAME OVER / COMPLETION ==================
function triggerGameOver() {
  if (gameOver) return;
  gameOver = true;
  cancelAnimationFrame(animationId);
  animationId = null;

  const speedometer = document.getElementById("speedometer");
  const warningIndicator = document.getElementById("warningIndicator");
  if (speedometer) speedometer.style.display = "none";
  if (warningIndicator) warningIndicator.style.display = "none";

  const finalTime = document.getElementById("finalTime");
  if (finalTime) finalTime.textContent = formatTime(elapsedTime);

  startCameraOrbit(() => {
    const gameOverElement = document.getElementById("gameOver");
    if (gameOverElement) gameOverElement.style.display = "block";
  });
}

function handleGameCompletion() {
  if (gameCompleted) return;
  gameCompleted = true;
  cancelAnimationFrame(animationId);
  animationId = null;

  const speedometer = document.getElementById("speedometer");
  const warningIndicator = document.getElementById("warningIndicator");
  if (speedometer) speedometer.style.display = "none";
  if (warningIndicator) warningIndicator.style.display = "none";

  const completionTime = document.getElementById("completionTime");
  if (completionTime) completionTime.textContent = formatTime(elapsedTime);

  const avgSpeed = (distance / elapsedTime) * 3.6;
  const gameResultStats = document.getElementById("gameResultStats");
  if (gameResultStats) {
    gameResultStats.textContent =
      `Collisions: ${totalCollisions}, Avg Speed: ${avgSpeed.toFixed(1)} km/h, Score: ${scoreboard}`;
  }

  obstacles.forEach(({ mesh, body }) => {
    mesh.visible = false;
    body.position.set(0, -1000, 0);
  });
  obstacles = [];

  startCameraOrbit(() => {
    updateLeaderboard();
    const gameCompleteElement = document.getElementById("gameComplete");
    if (gameCompleteElement) gameCompleteElement.style.display = "block";
  });
}

// ================== CAMERA ORBIT ==================
function startCameraOrbit(onComplete) {
  orbitActive = true;
  orbitStartTime = Date.now();

  function orbitStep() {
    const now = Date.now();
    const t = (now - orbitStartTime) / 2000; // 2s orbit
    if (t < 1) {
      const angle = 2 * Math.PI * t;
      const radius = 15;
      let center = new THREE.Vector3(0, 0, 0);
      if (MTC) {
        center.copy(MTC.position);
      }
      camera.position.x = center.x + Math.cos(angle) * radius;
      camera.position.z = center.z + Math.sin(angle) * radius;
      camera.position.y = 5 + 2 * Math.sin(t * Math.PI);
      camera.lookAt(center);
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

  joystickBase.removeEventListener("touchstart", onJoystickStart);
  joystickBase.removeEventListener("touchmove", onJoystickMove);
  joystickBase.removeEventListener("touchend", onJoystickEnd);
  joystickBase.removeEventListener("mousedown", onJoystickStart);
  document.removeEventListener("mousemove", onJoystickMove);
  document.removeEventListener("mouseup", onJoystickEnd);

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

/**
 * NOTE: We want:
 * - Joystick pulled "backward" (the bottom of the screen) => accelerate => +Z
 *   That means joystickY > +deadZone => accelerateInput
 * - Joystick pulled "forward" (the top of the screen) => decelerate => -Z
 *   That means joystickY < -deadZone => decelerateInput
 */
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
  // "Pull backward" => y > +0.2 => accelerate
  accelerateInput = joystickY > deadZone;
  // "Pull forward" => y < -0.2 => decelerate
  decelerateInput = joystickY < -deadZone;
  moveLeft = joystickX < -deadZone;
  moveRight = joystickX > deadZone;
}

// ================== MAIN ANIMATION LOOP ==================
function animate() {
  if (gameOver || gameCompleted) {
    cancelAnimationFrame(animationId);
    animationId = null;
    return;
  }
  animationId = requestAnimationFrame(animate);

  const now = Date.now();
  const dt = (now - previousTime) / 1000;
  previousTime = now;

  // Step physics in discrete increments
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
    // Current velocity in +Z
    let currentVelZ = userCarBody.velocity.z;

    // Joystick controls: pulling backward => accelerate => +Z
    if (accelerateInput) {
      currentVelZ = Math.min(currentVelZ + 5, maxVelocity);
    } else if (decelerateInput) {
      currentVelZ = Math.max(currentVelZ - 5, minVelocity);
    } else {
      // Approach baseVelocity if no input
      if (currentVelZ > baseVelocity) {
        currentVelZ = Math.max(currentVelZ - 2 * dt, baseVelocity);
      } else if (currentVelZ < baseVelocity) {
        currentVelZ = Math.min(currentVelZ + 2 * dt, baseVelocity);
      }
    }
    userCarBody.velocity.z = currentVelZ;

    // Side movement
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

  syncMeshesToBodies();
  updateObstacles(dt);
}

function updateVisuals(dt) {
  elapsedTime = (Date.now() - startTime) / 1000;
  const timeElement = document.getElementById("time");
  if (timeElement) {
    timeElement.textContent = `Time: ${formatTime(elapsedTime)}`;
  }

  difficultyRamp = elapsedTime * 0.2;

  // The user car's forward distance is userCarBody.position.z
  if (userCarBody) {
    distance = Math.max(0, userCarBody.position.z);
  }
  scoreboard = Math.floor(distance);

  const distanceElement = document.getElementById("distance");
  if (distanceElement) {
    distanceElement.textContent = `Distance: ${distance.toFixed(1)} m`;
  }

  const scoreElement = document.getElementById("score");
  if (scoreElement) {
    scoreElement.textContent = `Score: ${scoreboard}`;
  }

  // Check for completion
  if (distance >= completionDistance) {
    handleGameCompletion();
    return;
  }

  // Speedometer
  if (userCarBody) {
    const speedKmh = Math.abs(userCarBody.velocity.length()) * 3.6;
    const speedometer = document.getElementById("speedometer");
    if (speedometer) {
      speedometer.textContent = `${speedKmh.toFixed(0)} km/h`;
    }
  }

  // Slight car tilt
  if (MTC) {
    if (moveLeft) {
      MTC.rotation.z = 0.1;
    } else if (moveRight) {
      MTC.rotation.z = -0.1;
    } else {
      MTC.rotation.z *= 0.9;
      MTC.rotation.z = THREE.MathUtils.clamp(MTC.rotation.z, -0.2, 0.2);
    }
  }

  if (!orbitActive) {
    updateCamera();
  }
}

function syncMeshesToBodies() {
  if (MTC && userCarBody) {
    MTC.position.copy(userCarBody.position);
    MTC.quaternion.copy(userCarBody.quaternion);
  }

  obstacles.forEach(({ mesh, body }) => {
    if (mesh && body) {
      mesh.position.copy(body.position);
      mesh.quaternion.copy(body.quaternion);
    }
  });
}

function updateCamera() {
  if (!userCarBody) return;
  const desiredPos = new THREE.Vector3(
    userCarBody.position.x,
    5,
    userCarBody.position.z - 15
  );
  camera.position.lerp(desiredPos, 0.1);
  camera.lookAt(
    userCarBody.position.x,
    userCarBody.position.y,
    userCarBody.position.z
  );
}

// ================== LEADERBOARD & UI ==================
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
    const nameInputContainer = document.getElementById("nameInputContainer");
    if (nameInputContainer) {
      nameInputContainer.style.display = "block";
    }
    let submitBtn = document.getElementById("submitNameButton");
    if (submitBtn) {
      submitBtn.replaceWith(submitBtn.cloneNode(true));
      submitBtn = document.getElementById("submitNameButton");
      if (submitBtn) {
        submitBtn.addEventListener("click", () => {
          const nameInput = document.getElementById("nameInput");
          const name = nameInput ? nameInput.value.trim() || "Anonymous" : "Anonymous";
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
          if (nameInputContainer) {
            nameInputContainer.style.display = "none";
          }
          const gameCompleteElement = document.getElementById("gameComplete");
          if (gameCompleteElement) {
            gameCompleteElement.style.display = "none";
          }
        });
      }
    }
  } else {
    displayLeaderboard();
  }
  updateBestTimeDisplay();
}

function displayLeaderboard() {
  const list = document.getElementById("leaderboardList");
  if (!list) return;
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
  const bestTimeElement = document.getElementById("bestTime");
  if (!bestTimeElement) return;
  if (leaderboard.length > 0) {
    bestTimeElement.textContent = `Best Time: ${formatTime(leaderboard[0].time)}`;
  } else {
    bestTimeElement.textContent = "Best Time: N/A";
  }
}

// ================== GAME CONTROLS ==================
function startGame() {
  const startScreen = document.getElementById("start-screen");
  const instructions = document.getElementById("instructions");
  if (startScreen) startScreen.style.display = "none";
  if (instructions) instructions.style.display = "none";

  // Simple camera animation from some distance
  startCameraAnimation();
}

function startCameraAnimation() {
  const startPos = new THREE.Vector3(0, 30, -80);
  const endPos = new THREE.Vector3(0, 5, -15);
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

  const gameOverElement = document.getElementById("gameOver");
  const gameCompleteElement = document.getElementById("gameComplete");
  const warningIndicator = document.getElementById("warningIndicator");
  if (gameOverElement) gameOverElement.style.display = "none";
  if (gameCompleteElement) gameCompleteElement.style.display = "none";
  if (warningIndicator) {
    warningIndicator.style.display = "none";
    warningIndicator.classList.remove("flashing");
    warningIndicator.style.animation = "";
  }

  updateHealthBar();

  // Reposition user car to ground
  if (userCarBody) {
    // place it so it definitely touches the ground
    const halfHeight = (userCarBody.shapes[0].halfExtents.y);
    userCarBody.position.set(0, halfHeight, 0);
    userCarBody.velocity.set(0, 0, 0);
    userCarBody.angularVelocity.set(0, 0, 0);
    userCarBody.quaternion.set(0, 0, 0, 1);
  }
  if (MTC) {
    if (userCarBody) {
      MTC.position.copy(userCarBody.position);
    }
    MTC.rotation.set(0, 0, 0);
  }

  // Hide all obstacles
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

  // Invulnerability
  invulnerable = true;
  setTimeout(() => {
    invulnerable = false;
  }, invulnerabilityDuration);
}

// Helper to format time
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
  loadModels(); 
  setupEnvironment();
  initJoystick();

  // UI
  const playButton = document.getElementById("play-button");
  const restartButtons = document.querySelectorAll("#restartButton, #restartButtonComplete");
  const continueLinks = document.querySelectorAll("#continueLink, #continueLinkComplete");

  if (playButton) {
    playButton.addEventListener("click", startGame);
  }
  restartButtons.forEach(btn => {
    if (btn) {
      btn.addEventListener("click", () => {
        resetGameState();
        if (!animationId) {
          animate();
        }
      });
    }
  });
  continueLinks.forEach(link => {
    if (link) {
      link.addEventListener("click", () => {
        window.location.href = "https://air.zone";
      });
    }
  });

  displayLeaderboard();
  updateBestTimeDisplay();
}

document.addEventListener("DOMContentLoaded", () => {
  init();
});
