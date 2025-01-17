/*********************************************************************
 * script.js (Cannon.js-based physics and performance optimizations)
 * 
 * KEY FIX: Added IIFE wrapper to prevent variable/function redefinitions
 * 
 * REQUIRES:
 *   1) Cannon.js  (e.g. https://cdn.jsdelivr.net/npm/cannon@0.6.2/build/cannon.min.js)
 *   2) Three.js   (e.g. https://cdn.jsdelivr.net/npm/three@0.152.2/build/three.min.js)
 *   3) GLTFLoader (e.g. https://cdn.jsdelivr.net/npm/three@0.152.2/examples/js/loaders/GLTFLoader.js)
 *********************************************************************/

(function() {
  // ================== GLOBALS ==================
  let scene, camera, renderer;
  let environmentGroup;
  let MTC; // user's car (Three.js object)
  let userCarBody; // user's car (Cannon body)
  let userCarLoaded = false;

  let physicsWorld;
  let obstacleModels = {};  // { taxi, bus, lgv, bike }
  let obstaclePool = [];    // Three.js meshes
  let obstacleBodies = [];  // Cannon bodies
  let obstacles = [];

  const obstacleTypes = ["taxi", "bus", "lgv", "bike"];
  const maxObstacles = 10;

  let lanePositions = [-2, 0, 2];
  let accelerateInput = false,
    decelerateInput = false,
    moveLeft = false,
    moveRight = false;

  let velocity = 6.944; // ~25 km/h (base)
  const baseVelocity = 6.944;
  const minVelocity = 0.278;
  const maxVelocity = 44.444;

  let collisionCount = 0;
  let gameOver = false;
  let gameCompleted = false;

  let distance = 0;    // meters traveled
  let scoreboard = 0;  // 1 point per meter
  let totalCollisions = 0;
  let elapsedTime = 0;
  let startTime = 0;
  let previousTime = 0;
  let animationId;

  let obstacleFrequency = 2; // spawn obstacle every 2s
  let obstacleTimer = 0;
  let difficultyRamp = 0;
  const completionDistance = 2000;

  let orbitActive = false;
  let orbitStartTime = 0;

  // Joystick variables
  let joystickBase, joystickKnob;
  let joystickActive = false;
  let joystickMaxDistance = 0;
  let joystickX = 0;
  let joystickY = 0;

  // Leaderboard
  let leaderboard = JSON.parse(localStorage.getItem("leaderboard")) || [];

  // For updating physics at a fixed rate
  let physicsDeltaTime = 0;
  const PHYSICS_STEP = 1 / 50; // 50Hz

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

  // ================== PHYSICS SETUP ==================
  function initPhysics() {
    physicsWorld = new CANNON.World();
    physicsWorld.gravity.set(0, -9.82, 0);
    physicsWorld.broadphase = new CANNON.NaiveBroadphase();
    physicsWorld.solver.iterations = 10;
    physicsWorld.defaultContactMaterial.friction = 0.3;

    const groundMaterial = new CANNON.Material("groundMat");
    const groundBody = new CANNON.Body({
      mass: 0,
      material: groundMaterial,
      shape: new CANNON.Plane()
    });
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    physicsWorld.addBody(groundBody);
  }

  function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ================== LOAD MODELS ==================
  function loadModels() {
    const loader = new THREE.GLTFLoader();

    // Load user car
    loader.load(
      "mtc.glb",
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
      },
      undefined,
      (err) => console.error("Error loading mtc.glb:", err)
    );

    // Load obstacles
    loader.load("taxi.glb", (gltf) => {
      obstacleModels.taxi = gltf.scene;
    });

    loader.load("Bus.glb", (gltf) => {
      const bus = gltf.scene;
      bus.scale.set(3, 3, 3);
      obstacleModels.bus = bus;
    });

    loader.load("LGV.glb", (gltf) => {
      obstacleModels.lgv = gltf.scene;
    });

    loader.load("Bike.glb", (gltf) => {
      const bike = gltf.scene;
      bike.scale.set(2, 2, 2);
      bike.rotation.y = Math.PI / 2;
      obstacleModels.bike = bike;
    });
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

    // Create lampposts and traffic lights with reusable geometries
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

    // Place lampposts
    for (let z = -roadLength / 2; z < roadLength / 2; z += 50) {
      createLamppost(-roadWidth / 2 - 1, z, lamppostData);
      createLamppost(roadWidth / 2 + 1, z, lamppostData);
    }

    // Place traffic lights
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
    let loadedAll = obstacleTypes.every((t) => obstacleModels[t]);
    if (!loadedAll) {
      console.warn("Obstacle models not fully loaded yet. Retrying in 2s...");
      setTimeout(() => initObstaclePool(), 2000);
      return;
    }

    for (let i = 0; i < maxObstacles; i++) {
      let type = obstacleTypes[i % obstacleTypes.length];
      let model = obstacleModels[type];
      if (!model) continue;

      let clone = model.clone();
      clone.userData.type = type
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
        angularDamping: 0.4,
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

    let obs = obstaclePool[poolIndex];
    let obsBody = obstacleBodies[poolIndex];

    obs.visible = true;
    const lane = lanePositions[Math.floor(Math.random() * lanePositions.length)];
    let spawnZ = userCarBody.position.z - 100 - Math.random() * 50;

    obs.position.set(lane, 0.2, spawnZ);
    obs.rotation.set(0, Math.PI, 0);

    obsBody.position.set(lane, 0.2, spawnZ);
    obsBody.velocity.set(0, 0, 0);
    obsBody.angularVelocity.set(0, 0, 0);
    obsBody.quaternion.setFromEuler(0, Math.PI, 0);

    const obstacleSpeed = (22.222 + difficultyRamp) + Math.random() * 10;
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

      if (body.position.z > userCarBody.position.z + 50) {
        mesh.visible = false;
        body.position.set(0, -1000, 0);
        obstacles.splice(i, 1);
        continue;
      }

      if (!frustum.intersectsObject(mesh)) {
        if (body.position.z > userCarBody.position.z + 100) {
          mesh.visible = false;
          body.position.set(0, -1000, 0);
          obstacles.splice(i, 1);
        }
      }
    }
  }

  // ================== COLLISIONS ==================
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
    let avgSpeed = (distance / elapsedTime) * 3.6;
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
    
    if (!joystickBase || !joystickKnob) {
      console.warn("Joystick elements not found");
      return;
    }

    joystickMaxDistance = joystickBase.offsetWidth / 2;

    // Remove existing listeners first
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

  // ================== ANIMATION LOOP ==================
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
      // Forward/Backward
      let currentVelZ = userCarBody.velocity.z;
      if (accelerateInput) {
        currentVelZ = Math.max(currentVelZ - 5, -maxVelocity);
      } else if (decelerateInput) {
        currentVelZ = Math.min(currentVelZ + 5, -minVelocity);
      } else {
        let baseZ = -baseVelocity;
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
        userCarBody.velocity.x *= 0.9;
        if (Math.abs(userCarBody.velocity.x) < 0.05) {
          userCarBody.velocity.x = 0;
        }
      }
    }

    // Update obstacles
    obstacles.forEach(({ body }) => {
      body.velocity.z = body.userData.speed;
    });

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

    // Update speedometer
    if (userCarBody) {
      const speedKmh = Math.abs(userCarBody.velocity.length()) * 3.6;
      document.getElementById("speedometer").textContent = `${speedKmh.toFixed(0)} km/h`;
    }

    // Car visual tilt
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
    const desiredPos = new THREE.Vector3(
      userCarBody.position.x,
      5,
      userCarBody.position.z + 15
    );
    camera.position.lerp(desiredPos, 0.1);
    camera.lookAt(userCarBody.position.x, userCarBody.position.y, userCarBody.position.z);
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

  // ================== GAME CONTROLS ==================
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

    if (userCarBody) {
      userCarBody.position.set(0, 1.1, 0);
      userCarBody.velocity.set(0, 0, 0);
      userCarBody.angularVelocity.set(0, 0, 0);
      userCarBody.quaternion.set(0, 0, 0, 1);
    }
    
    if (MTC) {
      MTC.position.set(0, 1.1, 0);
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
    loadModels();
    setupEnvironment();
    initJoystick();

    // Hook up UI buttons
    document.getElementById("play-button").addEventListener("click", startGame);
    document.getElementById("restartButton").addEventListener("click", resetGameState);
    document.getElementById("continueLink").addEventListener("click", () => {
      window.location.href = "https://air.zone";
    });
    document.getElementById("restartButtonComplete").addEventListener("click", resetGameState);
    document.getElementById("continueLinkComplete").addEventListener("click", () => {
      window.location.href = "https://air.zone";
    });

    // Initialize obstacle pool after a short delay
    setTimeout(() => {
      initObstaclePool();
    }, 4000);

    // Show initial leaderboard
    displayLeaderboard();
    updateBestTimeDisplay();
  }

  // ================== EXPOSE PUBLIC INTERFACE ==================
  window.gameInterface = {
    init,
    startGame,
    resetGameState
  };

})();

// Initialize the game when the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.gameInterface.init();
});
