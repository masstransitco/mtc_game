/*****************************************************
 * main.js (Force-based Car + Steering Wheel Joystick)
 *
 * Demonstrates:
 *  1) Applying forces for acceleration/braking
 *  2) Steering by rotating the car about Y
 *  3) Joystick ring shaped like a steering wheel
 *****************************************************/

// ========== Imports ==========
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import * as CANNON from "cannon-es";

// ========== GLOBALS ==========
// Scene
let scene, camera, renderer;
let physicsWorld;

// Car
let carMesh, carBody;
let heading = 0; // Our car's facing direction (radians about Y-axis)

// Steering
let joystickBase, joystickKnob;
let steeringWheelActive = false;
let steeringWheelMaxRadius = 0;
let steeringAngle = 0;       // Current steering wheel angle, e.g. -1 to 1 normalized
const MAX_STEERING_ANGLE = Math.PI / 4; // +/- 45 degrees for the front wheels
const STEERING_RESPONSE = 2; // how quickly the heading catches up to wheel angle

// Buttons for accelerate / brake
let accelerateButton, brakeButton;
let accelerateInput = false;
let brakeInput = false;

// Car driving constants
const ENGINE_FORCE = 1200;  // Newtons (some arbitrary force)
const BRAKE_FORCE = 900;    // Negative force when braking
const MAX_FORWARD_SPEED = 20; // m/s ~ 72 km/h
const MAX_REVERSE_SPEED = 5;  // m/s ~ 18 km/h

// Physics stepping
let previousTime = 0;
let animationId;

// UI elements for collisions, etc.
let collisionIndicator; // We show "Collision!" text on collision

// ========== INIT ==========
function init() {
  initScene();
  initPhysics();
  initEnvironment();
  spawnObstacles(); // optional: place obstacles
  loadCarModelWithDraco(); // Load Draco .glb

  initSteeringWheelJoystick();
  initButtons();

  // Hook up the "Start" button to hide the start screen
  const startScreen = document.getElementById("start-screen");
  const playButton = document.getElementById("play-button");
  if (playButton) {
    playButton.addEventListener("click", () => {
      if (startScreen) {
        startScreen.style.display = "none";
      }
    });
  }

  // We'll show collisions in overlay
  collisionIndicator = document.getElementById("collisionIndicator");

  previousTime = Date.now();
  animate();
}

// ========== SCENE SETUP ==========
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);

  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    500
  );
  camera.position.set(0, 5, -15);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  // Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 20, -10);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 512;
  dirLight.shadow.mapSize.height = 512;
  scene.add(dirLight);

  window.addEventListener("resize", onWindowResize, false);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ========== PHYSICS WORLD ==========
function initPhysics() {
  physicsWorld = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.82, 0),
  });
  physicsWorld.solver.iterations = 10;
  // A bit of friction overall
  physicsWorld.defaultContactMaterial.friction = 0.4;

  // Infinite ground plane
  const groundBody = new CANNON.Body({ mass: 0 });
  const groundShape = new CANNON.Plane();
  groundBody.addShape(groundShape);
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  physicsWorld.addBody(groundBody);
}

// ========== ENVIRONMENT & OBSTACLES ==========
function initEnvironment() {
  const groundSize = 200;
  const groundGeom = new THREE.PlaneGeometry(groundSize, groundSize);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x228b22 });
  const groundMesh = new THREE.Mesh(groundGeom, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
}

// Basic obstacles
let obstacles = [];
let obstacleBodies = [];
function spawnObstacles() {
  // Example: 3 boxes in front
  const positions = [
    { x: 0, z: 30 },
    { x: 3, z: 50 },
    { x: -2, z: 70 }
  ];
  for (let pos of positions) {
    const size = 2;
    const geo = new THREE.BoxGeometry(size, size, size);
    const mat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(pos.x, size / 2, pos.z);
    scene.add(mesh);

    const half = size / 2;
    const shape = new CANNON.Box(new CANNON.Vec3(half, half, half));
    const body = new CANNON.Body({
      mass: 0,
      shape: shape,
      position: new CANNON.Vec3(pos.x, half, pos.z)
    });
    physicsWorld.addBody(body);

    obstacles.push(mesh);
    obstacleBodies.push(body);
  }
}

// ========== LOAD DRACO-COMPRESSED CAR ==========
function loadCarModelWithDraco() {
  const gltfLoader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath("/draco/");
  gltfLoader.setDRACOLoader(dracoLoader);

  gltfLoader.load(
    "/car1.glb",
    (gltf) => {
      carMesh = gltf.scene;
      carMesh.scale.set(2, 2, 2);
      scene.add(carMesh);

      carMesh.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // Create physics shape
      const carShape = new CANNON.Box(new CANNON.Vec3(1, 0.5, 2));
      carBody = new CANNON.Body({
        mass: 500, // Heavier car
        shape: carShape,
        // Slightly above ground
        position: new CANNON.Vec3(0, 1.1, 0),
        linearDamping: 0.2,  // Helps reduce infinite rolling
        angularDamping: 0.3, // Damp rotation
      });
      // We'll handle heading ourselves => fix rotation so Cannon doesn't spin it
      carBody.fixedRotation = false; 
      // But we can lock X and Z rotation if we don't want it to tip over:
      carBody.angularFactor.set(0, 1, 0);

      carBody.addEventListener("collide", handleCarCollision);

      physicsWorld.addBody(carBody);

      carMesh.position.set(0, 1.1, 0);
    },
    undefined,
    (error) => {
      console.error("Error loading Draco GLB:", error);
      createFallbackCar();
    }
  );
}

function createFallbackCar() {
  const geo = new THREE.BoxGeometry(2, 1, 4);
  const mat = new THREE.MeshLambertMaterial({ color: 0xff0000 });
  carMesh = new THREE.Mesh(geo, mat);
  carMesh.castShadow = true;
  scene.add(carMesh);

  const shape = new CANNON.Box(new CANNON.Vec3(1, 0.5, 2));
  carBody = new CANNON.Body({
    mass: 500,
    shape: shape,
    position: new CANNON.Vec3(0, 1.1, 0),
    linearDamping: 0.2,
    angularDamping: 0.3,
  });
  carBody.angularFactor.set(0, 1, 0);
  carBody.addEventListener("collide", handleCarCollision);
  physicsWorld.addBody(carBody);
  carMesh.position.set(0, 1.1, 0);
}

// ========== COLLISIONS ==========
function handleCarCollision(evt) {
  // Show a collision message
  if (collisionIndicator) {
    collisionIndicator.style.display = "block";
    collisionIndicator.textContent = "Collision!";
    setTimeout(() => {
      collisionIndicator.style.display = "none";
    }, 1000);
  }
  console.log("Car collided with body:", evt.body.id);
}

// ========== STEERING WHEEL JOYSTICK ==========
// We'll treat the knob as if the user is turning a steering wheel from -180° to +180°.
function initSteeringWheelJoystick() {
  joystickBase = document.getElementById("joystick-base");
  joystickKnob = document.getElementById("joystick-knob");
  if (!joystickBase || !joystickKnob) return;

  steeringWheelMaxRadius = joystickBase.offsetWidth / 2;

  // Clear any existing
  joystickBase.removeEventListener("touchstart", onSteeringWheelStart);
  joystickBase.removeEventListener("touchmove", onSteeringWheelMove);
  joystickBase.removeEventListener("touchend", onSteeringWheelEnd);
  joystickBase.removeEventListener("mousedown", onSteeringWheelStart);
  document.removeEventListener("mousemove", onSteeringWheelMove);
  document.removeEventListener("mouseup", onSteeringWheelEnd);

  joystickBase.addEventListener("touchstart", onSteeringWheelStart, { passive: false });
  joystickBase.addEventListener("touchmove", onSteeringWheelMove, { passive: false });
  joystickBase.addEventListener("touchend", onSteeringWheelEnd, { passive: false });
  joystickBase.addEventListener("mousedown", onSteeringWheelStart, { passive: false });
  document.addEventListener("mousemove", onSteeringWheelMove, { passive: false });
  document.addEventListener("mouseup", onSteeringWheelEnd, { passive: false });
}

function onSteeringWheelStart(e) {
  e.preventDefault();
  steeringWheelActive = true;
  joystickKnob.classList.add("active");
  updateSteeringWheel(e);
}

function onSteeringWheelMove(e) {
  if (!steeringWheelActive) return;
  e.preventDefault();
  updateSteeringWheel(e);
}

function onSteeringWheelEnd(e) {
  if (!steeringWheelActive) return;
  e.preventDefault();
  steeringWheelActive = false;
  joystickKnob.classList.remove("active");

  // Return to center
  joystickKnob.style.transition = "transform 0.3s ease";
  joystickKnob.style.transform = "translate(0,0) rotate(0deg)";
  setTimeout(() => {
    joystickKnob.style.transition = "none";
    steeringAngle = 0; // reset wheel angle
  }, 300);
}

function updateSteeringWheel(e) {
  const rect = joystickBase.getBoundingClientRect();
  let clientX, clientY;
  if (e.touches && e.touches[0]) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  } else {
    clientX = e.clientX;
    clientY = e.clientY;
  }

  // Center coords
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  // Vector from center to pointer
  const dx = clientX - cx;
  const dy = clientY - cy;
  // We'll interpret the angle from these deltas
  let angle = Math.atan2(dy, dx); // range: -pi to pi

  // We'll clamp to half a circle in either direction for a "wheel" effect if you like
  // But let's just keep the full range
  // Convert to degrees for visual
  let angleDeg = (angle * 180) / Math.PI;

  // For a real steering wheel, we might clamp to about -180 to +180
  // Let's do that:
  if (angleDeg < -180) angleDeg = -180;
  if (angleDeg > 180) angleDeg = 180;

  // Show the knob rotation
  joystickKnob.style.transform = `translate(0,0) rotate(${angleDeg}deg)`;

  // We'll convert -180..180 to a normalized -1..1
  steeringAngle = angleDeg / 180;

  // This means: steeringAngle = -1 is full left, +1 is full right
  // We'll interpret that in updateCarLogic as we apply heading changes
}

// ========== BUTTONS (Accelerate & Brake) ==========
function initButtons() {
  accelerateButton = document.getElementById("accelerateButton");
  brakeButton = document.getElementById("brakeButton");

  // ACCEL
  if (accelerateButton) {
    accelerateButton.addEventListener("mousedown", () => {
      accelerateInput = true;
    });
    accelerateButton.addEventListener("mouseup", () => {
      accelerateInput = false;
    });
    accelerateButton.addEventListener("touchstart", (e) => {
      e.preventDefault();
      accelerateInput = true;
    }, { passive: false });
    accelerateButton.addEventListener("touchend", (e) => {
      e.preventDefault();
      accelerateInput = false;
    }, { passive: false });
  }

  // BRAKE
  if (brakeButton) {
    brakeButton.addEventListener("mousedown", () => {
      brakeInput = true;
    });
    brakeButton.addEventListener("mouseup", () => {
      brakeInput = false;
    });
    brakeButton.addEventListener("touchstart", (e) => {
      e.preventDefault();
      brakeInput = true;
    }, { passive: false });
    brakeButton.addEventListener("touchend", (e) => {
      e.preventDefault();
      brakeInput = false;
    }, { passive: false });
  }
}

// ========== ANIMATION LOOP ==========
function animate() {
  animationId = requestAnimationFrame(animate);

  const now = Date.now();
  const dt = (now - previousTime) / 1000;
  previousTime = now;

  physicsWorld.step(1 / 60, dt, 3);

  updateCarLogic(dt);
  updateObstacles(); // in case obstacles move or we want to keep them synced
  renderer.render(scene, camera);
}

function updateObstacles() {
  // If obstacles are dynamic, sync them
  // Ours are static => no need, but left for completeness
  // obstacleBodies[i].position => obstacles[i].position
  // ...
}

// ========== CAR LOGIC ==========
// We'll rotate the car body about Y according to the "steeringAngle" we got from the wheel
// Then we apply force forward/back if accelerate or brake is pressed
// We also clamp top speed
function updateCarLogic(dt) {
  if (!carBody) return;

  // 1) Adjust heading => a "steeringAngle" of -1..1 => up to +/- 45 deg
  // We'll update heading gradually for a smooth effect
  const targetHeading = steeringAngle * MAX_STEERING_ANGLE; // in radians
  let currentHeading = getBodyYRotation(carBody); // read from body quaternion
  // We smoothly lerp to target heading
  const headingDiff = targetHeading - currentHeading;
  const maxTurnSpeed = STEERING_RESPONSE * dt; 
  const turnAmount = THREE.MathUtils.clamp(headingDiff, -maxTurnSpeed, maxTurnSpeed);
  currentHeading += turnAmount;

  // Now set the body’s rotation about Y
  setBodyYRotation(carBody, currentHeading);

  // 2) We can apply forward/back forces
  //   We'll figure out which direction "forward" is based on heading
  //   Because we actually just set rotation, we can compute forward from that
  const forwardVec = new CANNON.Vec3(-Math.sin(currentHeading), 0, -Math.cos(currentHeading));
  // negative sin/cos because in Three, heading=0 means facing -Z by default
  // Adjust sign if your model is oriented differently

  // We’ll see the current velocity in forward direction
  const vel = carBody.velocity.clone();
  const forwardSpeed = vel.dot(forwardVec); // projection onto forward

  // ========== GAS PEDAL ==========
  if (accelerateInput) {
    // If we’re under max speed, apply a forward force
    if (forwardSpeed < MAX_FORWARD_SPEED) {
      const forceMag = ENGINE_FORCE; 
      const force = forwardVec.scale(forceMag);
      carBody.applyForce(force, carBody.position);
    }
  }

  // ========== BRAKE PEDAL ==========
  if (brakeInput) {
    // If moving forward, apply negative force
    // If we are going forward, we slow down
    // If we keep applying brake beyond zero speed, we can go reverse
    // We'll do a simpler approach: always apply a negative force
    if (forwardSpeed > -MAX_REVERSE_SPEED) {
      const forceMag = BRAKE_FORCE;
      const reverseForce = forwardVec.scale(-forceMag);
      carBody.applyForce(reverseForce, carBody.position);
    }
  }

  // 3) Limit top speed
  const speedVec = carBody.velocity;
  const currentSpeed = speedVec.length();
  const maxAllowedSpeed = 40; // just a big clamp (like 144 km/h)
  if (currentSpeed > maxAllowedSpeed) {
    // scale it down
    speedVec.scale(maxAllowedSpeed / currentSpeed, speedVec);
  }

  // Sync visuals
  if (carMesh) {
    carMesh.position.copy(carBody.position);
    carMesh.quaternion.copy(carBody.quaternion);
  }

  // Update camera
  updateCamera();
}

function updateCamera() {
  const desiredPos = new THREE.Vector3(
    carBody.position.x,
    5,
    carBody.position.z + 15 // if heading=0 means facing -Z, camera behind is +Z
  );
  // But we actually want the camera behind the car, so let's compute offset
  // A quick approach is to compute behind in the opposite direction of heading:
  const behindVec = new THREE.Vector3(
    Math.sin(getBodyYRotation(carBody)), 
    0, 
    Math.cos(getBodyYRotation(carBody))
  );
  // that vector is "behind" if heading=0 => behind is +Z
  behindVec.multiplyScalar(10); // distance behind
  behindVec.y = 5;             // height
  desiredPos.set(
    carBody.position.x + behindVec.x,
    carBody.position.y + behindVec.y,
    carBody.position.z + behindVec.z
  );

  camera.position.lerp(desiredPos, 0.1);
  camera.lookAt(carBody.position.x, carBody.position.y, carBody.position.z);
}

// ========== HELPERS FOR Y ROTATION IN CANNON BODY ==========
// Because we rotate the body about Y to face heading
function getBodyYRotation(body) {
  // Extract yaw from the quaternion
  // We'll do a quick approach: quaternion => Euler => y
  const q = body.quaternion;
  const euler = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion(q.x, q.y, q.z, q.w),
    "YXZ"
  );
  return euler.y;
}

function setBodyYRotation(body, newHeading) {
  // keep pitch/roll from messing up => only set yaw
  const euler = new THREE.Euler(0, newHeading, 0, "YXZ");
  const quat = new THREE.Quaternion().setFromEuler(euler);
  body.quaternion.set(quat.x, quat.y, quat.z, quat.w);
}

// ========== ENTRY POINT ==========
document.addEventListener("DOMContentLoaded", () => {
  init();
});
