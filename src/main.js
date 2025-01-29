/*****************************************************
 * main.js
 * - Basic 3D Car Game with Three.js and Cannon-es
 * - Features:
 *   - Flat Ground Plane
 *   - Simple Box Car Model
 *   - Acceleration & Braking Controls
 *   - Steering via Joystick
 *   - Speed & RPM Indicators
 *   - Collision Feedback
 *****************************************************/

// ========== Imports ==========
import * as THREE from 'https://unpkg.com/three@0.148.0/build/three.module.js';
import * as CANNON from 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';

// ========== GLOBAL VARIABLES ==========
let scene, camera, renderer;
let physicsWorld;

// Car
let carMesh, carBody;

// Ground
let groundMesh, groundBody;

// Controls
let accelButton, brakeButton;
let accelInput = false, brakeInput = false;
let steeringBase, steeringKnob;
let steeringAngle = 0;

// UI Indicators
let collisionIndicator, speedIndicator, rpmIndicator;

// Driving Constants
const ENGINE_FORCE = 1500;
const BRAKE_FORCE = 1500;
const MAX_SPEED = 25; // m/s (~90 km/h)
const STEER_MAX_ANGLE = Math.PI / 4; // 45 degrees

// Timing
let clock;

// ========== INITIALIZATION ==========
function init() {
  initScene();
  initPhysics();
  createGround();
  createCar();
  initControls();
  initUI();
  animate();
}

// ========== SCENE SETUP ==========
function initScene() {
  // Create Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb); // Sky Blue

  // Create Camera
  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(0, 10, 20);
  camera.lookAt(0, 0, 0);

  // Create Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  // Add Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(10, 20, 10);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 1024;
  directionalLight.shadow.mapSize.height = 1024;
  scene.add(directionalLight);

  // Handle Window Resize
  window.addEventListener('resize', onWindowResize, false);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ========== PHYSICS SETUP ==========
function initPhysics() {
  // Create Physics World
  physicsWorld = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.82, 0), // m/s²
  });
  physicsWorld.broadphase = new CANNON.NaiveBroadphase();
  physicsWorld.solver.iterations = 10;

  // Initialize Clock
  clock = new THREE.Clock();
}

// ========== GROUND CREATION ==========
function createGround() {
  // Visual Ground
  const groundSize = 100;
  const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize);
  const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x228b22 }); // Forest Green
  groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
  groundMesh.rotation.x = -Math.PI / 2; // Rotate to make it horizontal
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // Physics Ground
  const groundShape = new CANNON.Plane();
  groundBody = new CANNON.Body({
    mass: 0, // Static
    shape: groundShape,
    material: new CANNON.Material({ friction: 0.4, restitution: 0.3 }),
  });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0); // Rotate to match visual ground
  physicsWorld.addBody(groundBody);
}

// ========== CAR CREATION ==========
function createCar() {
  // Visual Car (Box)
  const carWidth = 2;
  const carHeight = 1;
  const carLength = 4;
  const carGeometry = new THREE.BoxGeometry(carWidth, carHeight, carLength);
  const carMaterial = new THREE.MeshLambertMaterial({ color: 0xff0000 }); // Red
  carMesh = new THREE.Mesh(carGeometry, carMaterial);
  carMesh.castShadow = true;
  carMesh.receiveShadow = true;
  scene.add(carMesh);

  // Physics Car
  const carShape = new CANNON.Box(new CANNON.Vec3(carWidth / 2, carHeight / 2, carLength / 2));
  carBody = new CANNON.Body({
    mass: 1500, // kg
    shape: carShape,
    position: new CANNON.Vec3(0, carHeight / 2 + 0.5, 0), // Slightly above ground
    material: new CANNON.Material({ friction: 0.4, restitution: 0.3 }),
  });
  carBody.angularDamping = 0.5; // Reduce rotation over time
  physicsWorld.addBody(carBody);

  // Sync Initial Position
  carMesh.position.copy(carBody.position);
  carMesh.quaternion.copy(carBody.quaternion);
}

// ========== CONTROLS SETUP ==========
function initControls() {
  // Accelerate Button
  accelButton = document.getElementById('accelerateButton');
  if (accelButton) {
    accelButton.addEventListener('mousedown', () => { accelInput = true; accelButton.style.background = 'darkgreen'; });
    accelButton.addEventListener('mouseup', () => { accelInput = false; accelButton.style.background = 'green'; });
    accelButton.addEventListener('mouseleave', () => { accelInput = false; accelButton.style.background = 'green'; });
    accelButton.addEventListener('touchstart', (e) => { e.preventDefault(); accelInput = true; accelButton.style.background = 'darkgreen'; }, { passive: false });
    accelButton.addEventListener('touchend', () => { accelInput = false; accelButton.style.background = 'green'; }, { passive: false });
  }

  // Brake Button
  brakeButton = document.getElementById('brakeButton');
  if (brakeButton) {
    brakeButton.addEventListener('mousedown', () => { brakeInput = true; brakeButton.style.background = 'darkred'; });
    brakeButton.addEventListener('mouseup', () => { brakeInput = false; brakeButton.style.background = 'red'; });
    brakeButton.addEventListener('mouseleave', () => { brakeInput = false; brakeButton.style.background = 'red'; });
    brakeButton.addEventListener('touchstart', (e) => { e.preventDefault(); brakeInput = true; brakeButton.style.background = 'darkred'; }, { passive: false });
    brakeButton.addEventListener('touchend', () => { brakeInput = false; brakeButton.style.background = 'red'; }, { passive: false });
  }

  // Steering Joystick
  steeringBase = document.getElementById('joystick-base');
  steeringKnob = document.getElementById('joystick-knob');

  if (steeringBase && steeringKnob) {
    // Touch Events
    steeringBase.addEventListener('touchstart', onSteerStart, { passive: false });
    steeringBase.addEventListener('touchmove', onSteerMove, { passive: false });
    steeringBase.addEventListener('touchend', onSteerEnd, { passive: false });

    // Mouse Events
    steeringBase.addEventListener('mousedown', onSteerStart, { passive: false });
    document.addEventListener('mousemove', onSteerMove, { passive: false });
    document.addEventListener('mouseup', onSteerEnd, { passive: false });
  }
}

let steeringActive = false;

function onSteerStart(e) {
  e.preventDefault();
  steeringActive = true;
}

function onSteerMove(e) {
  if (!steeringActive) return;

  let clientX, clientY;
  if (e.touches && e.touches.length > 0) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  } else {
    clientX = e.clientX;
    clientY = e.clientY;
  }

  const rect = steeringBase.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  const dx = clientX - centerX;
  const dy = clientY - centerY;

  const distance = Math.sqrt(dx * dx + dy * dy);
  const maxDistance = rect.width / 2;

  let clampedX = dx;
  let clampedY = dy;

  if (distance > maxDistance) {
    clampedX = (dx / distance) * maxDistance;
    clampedY = (dy / distance) * maxDistance;
  }

  // Update knob position
  steeringKnob.style.transform = `translate(${clampedX}px, ${clampedY}px)`;

  // Calculate steering angle (-1 to 1)
  steeringAngle = clampedX / maxDistance;
}

function onSteerEnd(e) {
  if (!steeringActive) return;
  steeringActive = false;

  // Reset knob position
  steeringKnob.style.transform = `translate(0px, 0px)`;
  steeringAngle = 0;
}

// ========== UI INDICATORS ==========
function initUI() {
  collisionIndicator = document.getElementById('collisionIndicator');
  speedIndicator = document.getElementById('speedIndicator');
  rpmIndicator = document.getElementById('rpmIndicator');
}

// ========== ANIMATION LOOP ==========
function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();

  // Step Physics
  physicsWorld.step(1 / 60, delta, 3);

  // Handle Car Controls
  handleCarControls();

  // Sync Car Mesh with Physics Body
  carMesh.position.copy(carBody.position);
  carMesh.quaternion.copy(carBody.quaternion);

  // Update Camera to Follow Car
  updateCamera();

  // Update UI Indicators
  updateUI();

  // Render Scene
  renderer.render(scene, camera);
}

// ========== CAR CONTROLS ==========
function handleCarControls() {
  if (!carBody) return;

  // Calculate forward vector based on car's current rotation
  const forward = new CANNON.Vec3(
    Math.sin(carBody.quaternion.toEuler().y),
    0,
    Math.cos(carBody.quaternion.toEuler().y)
  );

  // Acceleration
  if (accelInput) {
    const force = forward.scale(ENGINE_FORCE);
    carBody.applyForce(force, carBody.position);
  }

  // Braking
  if (brakeInput) {
    const force = forward.scale(-BRAKE_FORCE);
    carBody.applyForce(force, carBody.position);
  }

  // Steering
  const maxSteer = STEER_MAX_ANGLE;
  const steer = steeringAngle * maxSteer;

  // Apply torque for steering
  carBody.angularVelocity.y = steer;
}

// ========== CAMERA UPDATE ==========
function updateCamera() {
  if (!carMesh) return;

  // Position the camera behind and above the car
  const relativeCameraOffset = new THREE.Vector3(0, 5, -10);
  const cameraOffset = relativeCameraOffset.applyMatrix4(carMesh.matrixWorld);

  camera.position.lerp(cameraOffset, 0.1); // Smooth camera movement
  camera.lookAt(carMesh.position);
}

// ========== UI UPDATE ==========
function updateUI() {
  if (!carBody) return;

  // Calculate speed in m/s and convert to km/h
  const velocity = carBody.velocity;
  const speed = velocity.length();
  const speedKmh = (speed * 3.6).toFixed(1);
  if (speedIndicator) {
    speedIndicator.textContent = `Speed: ${speedKmh} km/h`;
  }

  // Simple RPM calculation based on speed
  const rpm = Math.min(1000 + speed * 100, 7000); // Clamp RPM to realistic values
  if (rpmIndicator) {
    rpmIndicator.textContent = `RPM: ${rpm}`;
  }

  // Collision Feedback
  // This can be expanded with more detailed collision handling
}

// ========== COLLISION HANDLING ==========
function handleCollision(event) {
  if (collisionIndicator) {
    collisionIndicator.style.display = 'block';

    // Hide after a short delay
    setTimeout(() => {
      collisionIndicator.style.display = 'none';
    }, 1000);
  }
}

// Add collision event listener to the car
if (carBody) {
  carBody.addEventListener('collide', handleCollision);
}

// ========== STARTUP ==========
document.addEventListener('DOMContentLoaded', () => {
  const startScreen = document.getElementById('start-screen');
  const playButton = document.getElementById('play-button');

  if (playButton) {
    playButton.addEventListener('click', () => {
      // Hide start screen
      if (startScreen) {
        startScreen.style.display = 'none';
      }
      // Initialize the game
      init();
    });

    // Also handle touch events for mobile
    playButton.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (startScreen) {
        startScreen.style.display = 'none';
      }
      init();
    }, { passive: false });
  } else {
    // If no play button, initialize directly
    init();
  }
});
