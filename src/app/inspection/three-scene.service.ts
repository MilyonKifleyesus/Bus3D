import { Injectable, ElementRef, OnDestroy, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import * as THREE from 'three';
import { Subject } from 'rxjs';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

@Injectable()
export class ThreeSceneService implements OnDestroy {
  private platformId = inject(PLATFORM_ID);
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;
  private loader!: GLTFLoader;
  private resizeObserver: ResizeObserver | null = null;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private animationId: number | null = null;
  private busModel: THREE.Group | null = null;
  private inspector: THREE.Group | null = null;
  private inspectorBasePosition = new THREE.Vector3();
  private inspectorBaseRotationY = 0;
  private bayDoor: THREE.Group | null = null;
  private trolley: THREE.Object3D | null = null;
  private overheadLights: THREE.RectAreaLight[] = [];
  private busIndicators: THREE.PointLight[] = [];
  private busBrakeLights: THREE.PointLight[] = [];
  private flickerTimer = 0;
  private indicatorTimer = 0;
  private hotspots: THREE.Group[] = [];
  private introPhase: 'waiting' | 'driving' | 'parking' | 'complete' = 'waiting';
  private introProgress = 0;
  private introFallbackTimeout: number | null = null;
  private readonly introStartZ = 25;
  private readonly parkedBusPosition = new THREE.Vector3(0, 0, -1);
  private baseBusPosition = this.parkedBusPosition.clone();
  
  private doors = new Map<string, { 
    group: THREE.Group, 
    isOpen: boolean, 
    isHalfway: boolean,
    isLocked: boolean,
    targetX: number, 
    currentX: number,
    lockIndicator: THREE.Mesh
  }>();
  private lights: THREE.Group[] = [];
  private isNightMode = false;

  hotspotClicked = new Subject<string>();
  hotspotHovered = new Subject<string | null>();
  modelLoadError = new Subject<void>();
  loadingProgress = new Subject<number>();
  introComplete = new Subject<void>();

  private onResizeBound!: (event: UIEvent) => void;

  async init(container: ElementRef<HTMLDivElement>) {
    if (!isPlatformBrowser(this.platformId)) return;

    // Dynamic imports for browser-only libraries
    const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    this.loader = new GLTFLoader();
    
    const initialRect = container.nativeElement.getBoundingClientRect();
    const width = Math.max(Math.round(initialRect.width || container.nativeElement.clientWidth), 1);
    const height = Math.max(Math.round(initialRect.height || container.nativeElement.clientHeight), 1);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f172a); // Deep slate background
    
    this.camera = new THREE.PerspectiveCamera(24, width / height, 0.1, 1000);
    this.camera.position.set(12, 5, 12);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.nativeElement.appendChild(this.renderer.domElement);
    this.syncRendererSize(container.nativeElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 50;
    this.controls.target.set(0, 1, 0);

    // --- Lighting (10:00 AM Studio Lighting) ---
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
    sunLight.position.set(10, 20, 10);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 4096;
    sunLight.shadow.mapSize.height = 4096;
    sunLight.shadow.camera.left = -20;
    sunLight.shadow.camera.right = 20;
    sunLight.shadow.camera.top = 20;
    sunLight.shadow.camera.bottom = -20;
    this.scene.add(sunLight);

    // --- Atmosphere: Subtle Fog ---
    this.scene.fog = new THREE.Fog(0xC8D8E8, 30, 80);
    this.scene.background = new THREE.Color(0xC8D8E8); // Match fog color for depth haze effect

    // --- Environment: Inspection Bay ---
    this.createInspectionBay();

    // Load Model
    this.loadBusModel();
    
    // Add Equipment
    this.createBayEquipment();
    this.createInspector();

    this.animate();

    requestAnimationFrame(() => this.syncRendererSize(container.nativeElement));

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.syncRendererSize(container.nativeElement);
      });
      this.resizeObserver.observe(container.nativeElement);
    }

    this.onResizeBound = () => this.onResize(container);
    window.addEventListener('resize', this.onResizeBound);
    this.renderer.domElement.addEventListener('click', this.onClick.bind(this));
    this.renderer.domElement.addEventListener('mousemove', this.onMouseMove.bind(this));
  }

  private loadBusModel() {
    this.loader.load('/3DBus.glb', (gltf) => {
      console.log('Bus model loaded successfully:', gltf);
      const model = gltf.scene;
      model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      this.fitModelToBay(model);
      
      this.busModel = model;
      this.scene.add(model);

      // Add hotspots to the loaded model
      this.addHotspotsToModel(model);
      this.addInteractiveDoors(model, {
        accentMaterial: new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.8, roughness: 0.2 }),
        frameMaterial: new THREE.MeshStandardMaterial({
          color: 0x0f172a,
          metalness: 0.6,
          roughness: 0.35,
          transparent: true,
          opacity: 0.72
        }),
        glassMaterial: new THREE.MeshStandardMaterial({
          color: 0x93c5fd,
          transparent: true,
          opacity: 0.32,
          metalness: 0.85,
          roughness: 0.08
        })
      });
      
      // Start the cinematic intro now that the model is ready
      this.startCinematicIntro();
      
      // Mark loading as complete
      this.loadingProgress.next(100);
    }, (xhr) => {
      if (xhr.lengthComputable) {
        const percentComplete = (xhr.loaded / xhr.total) * 100;
        this.loadingProgress.next(percentComplete);
        console.log(`Loading progress: ${percentComplete.toFixed(2)}%`);
      }
    }, (error) => {
      console.error('Error loading bus model:', error);
      // Fallback to mock bus if loading fails
      this.createMockBus();
      this.startCinematicIntro();
      this.loadingProgress.next(100);
    });
  }

  private fitModelToBay(model: THREE.Group) {
    const initialBox = new THREE.Box3().setFromObject(model);
    const size = initialBox.getSize(new THREE.Vector3());
    console.log('Model size:', size);

    const scale = 10 / size.x;
    model.scale.setScalar(scale);

    const scaledBox = new THREE.Box3().setFromObject(model);
    const center = scaledBox.getCenter(new THREE.Vector3());
    const groundedY = -scaledBox.min.y;

    model.position.set(
      this.parkedBusPosition.x - center.x,
      groundedY,
      this.parkedBusPosition.z - center.z
    );

    this.baseBusPosition.copy(model.position);
  }

  private addHotspotsToModel(parent: THREE.Group) {
    // --- Hotspot Indicators ---
    this.addHotspotIndicator(parent, [5.0, 1.5, 0], 'front', 0xef4444);
    this.addHotspotIndicator(parent, [-5.0, 1.5, 0], 'rear', 0x94a3b8);
    this.addHotspotIndicator(parent, [0, 3.6, 0], 'roof', 0xef4444);
    this.addHotspotIndicator(parent, [0, 1.5, 1.6], 'curb_side', 0x94a3b8);
    this.addHotspotIndicator(parent, [0, 1.5, -1.6], 'street_side', 0x94a3b8);
    this.addHotspotIndicator(parent, [2, 1.5, 0], 'interior', 0xf59e0b);
    this.addHotspotIndicator(parent, [4.0, 1.5, 0.8], 'driver_area', 0x94a3b8);
    this.addHotspotIndicator(parent, [3.2, 0.5, 1.3], 'wheels_undercarriage', 0x94a3b8);
  }

  private createInspectionBay() {
    const bayGroup = new THREE.Group();

    // --- Floor: 22m wide x 14m deep, #B0A898 ---
    const floorGeom = new THREE.PlaneGeometry(22, 14);
    const floorMat = new THREE.MeshStandardMaterial({ 
      color: 0xB0A898, 
      roughness: 0.8,
      metalness: 0.1
    });
    const floor = new THREE.Mesh(floorGeom, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    bayGroup.add(floor);

    // --- Floor Joints (Expansion Joints) ---
    const jointMat = new THREE.MeshBasicMaterial({ color: 0x555555 });
    for (let i = -10; i <= 10; i += 2) {
      const joint = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 14), jointMat);
      joint.rotation.x = -Math.PI / 2;
      joint.position.set(i, 0.005, 0);
      bayGroup.add(joint);
    }
    for (let i = -6; i <= 6; i += 2) {
      const joint = new THREE.Mesh(new THREE.PlaneGeometry(22, 0.02), jointMat);
      joint.rotation.x = -Math.PI / 2;
      joint.position.set(0, 0.005, i);
      bayGroup.add(joint);
    }

    // --- Floor Details: Oil Stains & Tire Marks ---
    const stainMat = new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.2 });
    for (let i = 0; i < 15; i++) {
      const stain = new THREE.Mesh(new THREE.CircleGeometry(Math.random() * 0.6 + 0.2, 8), stainMat);
      stain.rotation.x = -Math.PI / 2;
      stain.position.set(Math.random() * 18 - 9, 0.015, Math.random() * 12 - 6);
      bayGroup.add(stain);
    }

    // --- Walls: 3 walls, #D6D0C8, height 6.9m ---
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xD6D0C8 });
    const backWallGeom = new THREE.PlaneGeometry(22, 6.9);
    const backWall = new THREE.Mesh(backWallGeom, wallMat);
    backWall.position.set(0, 3.45, -7);
    bayGroup.add(backWall);

    const sideWallGeom = new THREE.PlaneGeometry(14, 6.9);
    const leftWall = new THREE.Mesh(sideWallGeom, wallMat);
    leftWall.position.set(-11, 3.45, 0);
    leftWall.rotation.y = Math.PI / 2;
    bayGroup.add(leftWall);

    const rightWall = new THREE.Mesh(sideWallGeom, wallMat);
    rightWall.position.set(11, 3.45, 0);
    rightWall.rotation.y = -Math.PI / 2;
    bayGroup.add(rightWall);

    // --- Support Pillars & Beams ---
    const pillarGeom = new THREE.BoxGeometry(0.4, 6.9, 0.4);
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.5, roughness: 0.5 });
    const beamGeom = new THREE.BoxGeometry(22, 0.3, 0.3);
    
    [-11, 11].forEach(x => {
      [-5, 0, 5].forEach(z => {
        const pillar = new THREE.Mesh(pillarGeom, pillarMat);
        pillar.position.set(x * 0.98, 3.45, z);
        bayGroup.add(pillar);
      });
    });

    const topBeam = new THREE.Mesh(beamGeom, pillarMat);
    topBeam.position.set(0, 6.75, -6.85);
    bayGroup.add(topBeam);

    // --- High-Level Windows (Glow Effect) ---
    const windowGeom = new THREE.PlaneGeometry(2, 1.5);
    const windowMat = new THREE.MeshBasicMaterial({ color: 0xADD8E6, transparent: true, opacity: 0.6 });
    [-8, -4, 0, 4, 8].forEach(x => {
      const win = new THREE.Mesh(windowGeom, windowMat);
      win.position.set(x, 5, -6.98);
      bayGroup.add(win);
      
      const winGlow = new THREE.PointLight(0xADD8E6, 0.5, 5);
      winGlow.position.set(x, 5, -6.5);
      bayGroup.add(winGlow);
    });

    // --- Overhead Pipes & Vents ---
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.7, roughness: 0.3 });
    const mainPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 22, 16), pipeMat);
    mainPipe.rotation.z = Math.PI / 2;
    mainPipe.position.set(0, 6.2, -6.5);
    bayGroup.add(mainPipe);

    const ventGeom = new THREE.BoxGeometry(1.2, 0.4, 1.2);
    const ventMat = new THREE.MeshStandardMaterial({ color: 0x555555 });
    [-8, 0, 8].forEach(x => {
      const vent = new THREE.Mesh(ventGeom, ventMat);
      vent.position.set(x, 6.7, -6.5);
      bayGroup.add(vent);
    });

    // --- Ceiling: 22m x 14m, #C8C4BC ---
    const ceilingGeom = new THREE.PlaneGeometry(22, 14);
    const ceilingMat = new THREE.MeshStandardMaterial({ color: 0xC8C4BC });
    const ceiling = new THREE.Mesh(ceilingGeom, ceilingMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 6.9;
    bayGroup.add(ceiling);

    // --- Safety Markings: Yellow #F5E642 ---
    const laneMarkingGeom = new THREE.PlaneGeometry(0.2, 14);
    const markingMat = new THREE.MeshBasicMaterial({ color: 0xF5E642 });
    
    const leftLane = new THREE.Mesh(laneMarkingGeom, markingMat);
    leftLane.rotation.x = -Math.PI / 2;
    leftLane.position.set(-5.5, 0.02, 0);
    bayGroup.add(leftLane);

    const rightLane = leftLane.clone();
    rightLane.position.x = 5.5;
    bayGroup.add(rightLane);

    const stopLineGeom = new THREE.PlaneGeometry(22, 0.2);
    const stopLine = new THREE.Mesh(stopLineGeom, markingMat);
    stopLine.rotation.x = -Math.PI / 2;
    stopLine.position.set(0, 0.02, 5.5); // Z = +5.5m for front stop marker
    bayGroup.add(stopLine);

    // --- Safety Signage ---
    const createSign = (x: number, y: number, z: number, rotY: number, bgColor: number) => {
      const signGroup = new THREE.Group();
      const signGeom = new THREE.PlaneGeometry(0.8, 0.6);
      const signMat = new THREE.MeshBasicMaterial({ color: bgColor });
      const sign = new THREE.Mesh(signGeom, signMat);
      signGroup.add(sign);
      
      const symbol = new THREE.Mesh(new THREE.CircleGeometry(0.15, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      symbol.position.z = 0.01;
      sign.add(symbol);

      // Simulated text lines
      for (let i = 0; i < 3; i++) {
        const line = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.03), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        line.position.set(0, -0.15 - i * 0.08, 0.01);
        sign.add(line);
      }

      signGroup.position.set(x, y, z);
      signGroup.rotation.y = rotY;
      return signGroup;
    };
    bayGroup.add(createSign(-10.95, 2.5, 2, Math.PI / 2, 0x004488));
    bayGroup.add(createSign(10.95, 2.5, -2, -Math.PI / 2, 0xCC0000));
    bayGroup.add(createSign(-10.95, 2.5, -4, Math.PI / 2, 0xCC7700));

    // --- Wall Stripes ---
    const cyanStripeGeom = new THREE.PlaneGeometry(22, 0.1);
    const cyanMat = new THREE.MeshBasicMaterial({ color: 0x00AAEE });
    const cyanStripe = new THREE.Mesh(cyanStripeGeom, cyanMat);
    cyanStripe.position.set(0, 1.0, -6.99);
    bayGroup.add(cyanStripe);

    const navyStripeGeom = new THREE.PlaneGeometry(22, 0.2);
    const navyMat = new THREE.MeshBasicMaterial({ color: 0x004488 });
    const navyStripe = new THREE.Mesh(navyStripeGeom, navyMat);
    navyStripe.position.set(0, 2.2, -6.99);
    bayGroup.add(navyStripe);

    // --- Overhead Lights ---
    const fixtureGeom = new THREE.BoxGeometry(2, 0.2, 0.5);
    const fixtureMat = new THREE.MeshStandardMaterial({ color: 0x4A4A4A });
    const glowMat = new THREE.MeshStandardMaterial({ color: 0xFFFACD, emissive: 0xFFFACD, emissiveIntensity: 1 });
    const glowGeom = new THREE.PlaneGeometry(1.8, 0.45);

    [-4, 0, 4].forEach(x => {
      const fixture = new THREE.Mesh(fixtureGeom, fixtureMat);
      fixture.position.set(x, 6.8, 0);
      bayGroup.add(fixture);

      const glow = new THREE.Mesh(glowGeom, glowMat);
      glow.rotation.x = Math.PI / 2;
      glow.position.set(x, 6.69, 0);
      bayGroup.add(glow);

      const light = new THREE.PointLight(0xFFFACD, 0.8, 15);
      light.position.set(x, 6, 0);
      bayGroup.add(light);
      this.overheadLights.push(light as unknown as THREE.RectAreaLight); 
      fixture.userData['glow'] = glow;
    });

    this.scene.add(bayGroup);
  }

  private createInspector() {
    const inspectorsGroup = new THREE.Group();
    interface InspectorPlacement {
      modelPath: '/Samran.glb' | '/NaeemPeroson.glb';
      position: [number, number, number];
      rotationY: number;
      targetHeight: number;
      standoff?: number;
      onPrimary?: boolean;
      fallback: {
        color: number;
        pose: 'standing' | 'crouching' | 'action' | 'walking' | 'suit';
        isFemale?: boolean;
      };
    }

    const getPlacementTarget = (placement: InspectorPlacement) => {
      const outward = new THREE.Vector3(
        placement.position[0] - this.parkedBusPosition.x,
        0,
        placement.position[2] - this.parkedBusPosition.z
      );

      if (outward.lengthSq() === 0) {
        outward.set(0, 0, 1);
      } else {
        outward.normalize();
      }

      const standoff = placement.standoff ?? 0.75;
      return new THREE.Vector3(
        placement.position[0] + outward.x * standoff,
        placement.position[1],
        placement.position[2] + outward.z * standoff
      );
    };

    const addHumanoid = (
      x: number,
      y: number,
      z: number,
      rotY: number,
      color: number,
      pose: 'standing' | 'crouching' | 'action' | 'walking' | 'suit' = 'standing',
      isFemale = false
    ) => {
      const humanoid = new THREE.Group();

      const bodyHeight = pose === 'crouching' ? 0.6 : 0.9;
      const bodyGeom = new THREE.CylinderGeometry(isFemale ? 0.2 : 0.25, 0.2, bodyHeight, 8);
      const bodyMat = new THREE.MeshStandardMaterial({ color: pose === 'suit' ? 0x222222 : color });
      const body = new THREE.Mesh(bodyGeom, bodyMat);
      body.position.y = bodyHeight / 2 + (pose === 'crouching' ? 0.2 : 0.5);
      humanoid.add(body);

      const headGeom = new THREE.SphereGeometry(0.15, 16, 16);
      const headMat = new THREE.MeshStandardMaterial({ color: 0xffccaa });
      const head = new THREE.Mesh(headGeom, headMat);
      head.position.y = body.position.y + bodyHeight / 2 + 0.15;
      humanoid.add(head);

      const legGeom = new THREE.CylinderGeometry(0.1, 0.1, pose === 'crouching' ? 0.3 : 0.5, 8);
      const legL = new THREE.Mesh(legGeom, bodyMat);
      legL.position.set(-0.15, pose === 'crouching' ? 0.15 : 0.25, 0);
      if (pose === 'walking') legL.rotation.x = 0.3;
      humanoid.add(legL);

      const legR = legL.clone();
      legR.position.x = 0.15;
      if (pose === 'walking') legR.rotation.x = -0.3;
      humanoid.add(legR);

      const armGeom = new THREE.CylinderGeometry(0.08, 0.08, 0.6, 8);
      const armL = new THREE.Mesh(armGeom, bodyMat);
      armL.position.set(-0.35, body.position.y + 0.1, 0);
      if (pose === 'action') armL.rotation.x = -Math.PI / 3;
      humanoid.add(armL);

      const armR = armL.clone();
      armR.position.x = 0.35;
      if (pose === 'action') armR.rotation.x = -Math.PI / 3;
      humanoid.add(armR);

      if (pose === 'action' || pose === 'standing') {
        const boardGeom = new THREE.BoxGeometry(0.2, 0.3, 0.02);
        const board = new THREE.Mesh(boardGeom, new THREE.MeshStandardMaterial({ color: 0x888888 }));
        board.position.set(0.2, body.position.y + 0.2, 0.3);
        board.rotation.x = -Math.PI / 4;
        humanoid.add(board);
      }

      humanoid.position.set(x, y, z);
      humanoid.rotation.y = rotY;
      inspectorsGroup.add(humanoid);
      return humanoid;
    };

    const placeFallbackInspector = (placement: InspectorPlacement) => {
      const target = getPlacementTarget(placement);
      const fallback = addHumanoid(
        target.x,
        target.y,
        target.z,
        placement.rotationY,
        placement.fallback.color,
        placement.fallback.pose,
        placement.fallback.isFemale ?? false
      );

      if (placement.onPrimary) {
        this.inspector = fallback;
        this.inspectorBasePosition.copy(fallback.position);
        this.inspectorBaseRotationY = fallback.rotation.y;
      }
    };

    const placeInspectorModel = (placement: InspectorPlacement) => {
      this.loader.load(
        placement.modelPath,
        (gltf) => {
          const person = gltf.scene;
          person.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });

          const box = new THREE.Box3().setFromObject(person);
          const size = box.getSize(new THREE.Vector3());

          if (size.y > 0) {
            const scale = placement.targetHeight / size.y;
            person.scale.setScalar(scale);
          }

          const scaledBox = new THREE.Box3().setFromObject(person);
          const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
          const groundedY = -scaledBox.min.y;
          const target = getPlacementTarget(placement);

          person.position.set(
            target.x - scaledCenter.x,
            target.y + groundedY,
            target.z - scaledCenter.z
          );
          person.rotation.y = placement.rotationY;

          inspectorsGroup.add(person);

          if (placement.onPrimary) {
            this.inspector = person;
            this.inspectorBasePosition.copy(person.position);
            this.inspectorBaseRotationY = person.rotation.y;
          }
        },
        undefined,
        () => placeFallbackInspector(placement)
      );
    };

    const placements: InspectorPlacement[] = [
      {
        modelPath: '/Samran.glb',
        position: [6.0, 0, 5.8],
        rotationY: (-3 * Math.PI) / 4,
        targetHeight: 1.8,
        standoff: 0.55,
        onPrimary: true,
        fallback: { color: 0x334455, pose: 'action' }
      },
      {
        modelPath: '/NaeemPeroson.glb',
        position: [-6.6, 0, 1.8],
        rotationY: Math.PI / 2,
        targetHeight: 1.72,
        standoff: 0.55,
        fallback: { color: 0x445566, pose: 'crouching', isFemale: true }
      },
      {
        modelPath: '/Samran.glb',
        position: [6.4, 0, -5.9],
        rotationY: -Math.PI / 4,
        targetHeight: 1.82,
        standoff: 0.55,
        fallback: { color: 0x334455, pose: 'standing' }
      },
      {
        modelPath: '/NaeemPeroson.glb',
        position: [7.6, 0, -1.4],
        rotationY: -Math.PI / 2,
        targetHeight: 1.72,
        standoff: 0.45,
        fallback: { color: 0x445566, pose: 'walking', isFemale: true }
      },
      {
        modelPath: '/Samran.glb',
        position: [-9.2, 0, 4.8],
        rotationY: Math.PI / 3,
        targetHeight: 1.85,
        standoff: 0.35,
        fallback: { color: 0x111111, pose: 'suit' }
      }
    ];

    placements.forEach(placeInspectorModel);

    this.scene.add(inspectorsGroup);
  }

  private createBayEquipment() {
    const equipment = new THREE.Group();

    // Safety Cones: #FF6600
    const coneGeom = new THREE.ConeGeometry(0.2, 0.5, 16);
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xFF6600 });
    const coneBaseGeom = new THREE.BoxGeometry(0.4, 0.05, 0.4);
    
    const conePositions: [number, number, number][] = [
      [-2.5, 0.25, 3.5], [+2.5, 0.25, 3.5],
      [-2.5, 0.25, -6.5], [+2.5, 0.25, -6.5]
    ];

    conePositions.forEach(pos => {
      const coneGroup = new THREE.Group();
      const cone = new THREE.Mesh(coneGeom, coneMat);
      coneGroup.add(cone);
      const base = new THREE.Mesh(coneBaseGeom, new THREE.MeshStandardMaterial({ color: 0x333333 }));
      base.position.y = -0.22;
      coneGroup.add(base);
      coneGroup.position.set(pos[0], pos[1], pos[2]);
      equipment.add(coneGroup);
    });

    // Large Red Tool Trolley: #AA1111
    const trolleyGeom = new THREE.BoxGeometry(1, 1.2, 0.6);
    const trolleyMat = new THREE.MeshStandardMaterial({ color: 0xAA1111 });
    const trolley = new THREE.Mesh(trolleyGeom, trolleyMat);
    trolley.position.set(-6.5, 0.6, 1.5);
    equipment.add(trolley);
    this.trolley = trolley;

    // Socket Tool Box on Trolley
    const toolBoxGeom = new THREE.BoxGeometry(0.4, 0.2, 0.3);
    const toolBoxMat = new THREE.MeshStandardMaterial({ color: 0xCC2200 });
    const toolBox1 = new THREE.Mesh(toolBoxGeom, toolBoxMat);
    toolBox1.position.set(0, 0.7, 0);
    trolley.add(toolBox1);

    // Small Gunmetal Grey Tool Cart: #3A3A3A
    const cartGeom = new THREE.BoxGeometry(0.6, 0.8, 0.4);
    const cartMat = new THREE.MeshStandardMaterial({ color: 0x3A3A3A });
    const cart = new THREE.Mesh(cartGeom, cartMat);
    cart.position.set(6.5, 0.4, 1.5);
    equipment.add(cart);

    const toolBox2 = toolBox1.clone();
    toolBox2.position.set(0, 0.5, 0);
    cart.add(toolBox2);

    // Mechanics Creeper (Gunmetal #2A2A2A)
    const creeperGeom = new THREE.BoxGeometry(0.6, 0.1, 1.2);
    const creeperMat = new THREE.MeshStandardMaterial({ color: 0x2A2A2A });
    const creeper = new THREE.Mesh(creeperGeom, creeperMat);
    creeper.position.set(-2, 0.05, 0);
    equipment.add(creeper);

    // Floor Jacks (Workshop Red #CC2200)
    const jackGeom = new THREE.BoxGeometry(0.3, 0.2, 0.8);
    const jackMat = new THREE.MeshStandardMaterial({ color: 0xCC2200 });
    const jack1 = new THREE.Mesh(jackGeom, jackMat);
    jack1.position.set(-4, 0.1, -4);
    equipment.add(jack1);
    const jack2 = jack1.clone();
    jack2.position.set(4, 0.1, -4);
    equipment.add(jack2);

    // Fire Extinguishers (Safety Red #DD0000)
    const createExtinguisher = (x: number, y: number, z: number) => {
      const extGroup = new THREE.Group();
      const extBody = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.4, 16), new THREE.MeshStandardMaterial({ color: 0xDD0000 }));
      extGroup.add(extBody);
      const extTop = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 8), new THREE.MeshStandardMaterial({ color: 0xDD0000 }));
      extTop.position.y = 0.2;
      extGroup.add(extTop);
      extGroup.position.set(x, y, z);
      return extGroup;
    };
    equipment.add(createExtinguisher(-10.9, 1.5, -2));
    equipment.add(createExtinguisher(10.9, 1.5, 2));

    // Security Cameras (Matte Black #222222)
    const createCamera = (x: number, y: number, z: number, rotY: number) => {
      const camGroup = new THREE.Group();
      const camBody = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.3), new THREE.MeshStandardMaterial({ color: 0x222222 }));
      camGroup.add(camBody);
      const camLens = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 8), new THREE.MeshStandardMaterial({ color: 0x000000 }));
      camLens.rotation.x = Math.PI / 2;
      camLens.position.z = 0.15;
      camGroup.add(camLens);
      camGroup.position.set(x, y, z);
      camGroup.rotation.y = rotY;
      camGroup.rotation.x = 0.5;
      return camGroup;
    };
    equipment.add(createCamera(-10.5, 6.5, -6.5, Math.PI / 4));
    equipment.add(createCamera(10.5, 6.5, -6.5, -Math.PI / 4));
    equipment.add(createCamera(0, 6.5, 6.5, Math.PI));

    // Ladder
    const ladderGroup = new THREE.Group();
    const railGeom = new THREE.BoxGeometry(0.05, 3, 0.05);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x888888 });
    const railL = new THREE.Mesh(railGeom, railMat);
    railL.position.x = -0.25;
    ladderGroup.add(railL);
    const railR = new THREE.Mesh(railGeom, railMat);
    railR.position.x = 0.25;
    ladderGroup.add(railR);
    for (let y = -1.2; y <= 1.2; y += 0.4) {
      const rung = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.03), railMat);
      rung.position.y = y;
      ladderGroup.add(rung);
    }
    ladderGroup.position.set(10.5, 1.5, 3);
    ladderGroup.rotation.z = -0.1;
    equipment.add(ladderGroup);

    // Barrels
    const barrelGeom = new THREE.CylinderGeometry(0.3, 0.3, 0.9, 16);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x1e3a8a }); // Blue barrels
    const barrel1 = new THREE.Mesh(barrelGeom, barrelMat);
    barrel1.position.set(-10, 0.45, 5);
    equipment.add(barrel1);
    const barrel2 = barrel1.clone();
    barrel2.position.set(-9.3, 0.45, 5.2);
    equipment.add(barrel2);

    // First Aid Kit (on wall)
    const kitGeom = new THREE.BoxGeometry(0.1, 0.4, 0.4);
    const kitMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const kit = new THREE.Mesh(kitGeom, kitMat);
    kit.position.set(10.9, 1.5, -1);
    equipment.add(kit);
    const cross1 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.05), new THREE.MeshStandardMaterial({ color: 0xff0000 }));
    cross1.position.set(0.06, 0, 0);
    kit.add(cross1);
    const cross2 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.2), new THREE.MeshStandardMaterial({ color: 0xff0000 }));
    cross2.position.set(0.06, 0, 0);
    kit.add(cross2);

    this.scene.add(equipment);
  }

  private addInteractiveDoors(
    parent: THREE.Group,
    materials: {
      frameMaterial: THREE.MeshStandardMaterial;
      glassMaterial: THREE.MeshStandardMaterial;
      accentMaterial: THREE.MeshStandardMaterial;
    }
  ) {
    this.doors.clear();
    parent.add(this.createInteractiveDoor('front_door', 2.5, materials));
    parent.add(this.createInteractiveDoor('middle_door', -1, materials));
  }

  private createInteractiveDoor(
    doorId: 'front_door' | 'middle_door',
    xPos: number,
    materials: {
      frameMaterial: THREE.MeshStandardMaterial;
      glassMaterial: THREE.MeshStandardMaterial;
      accentMaterial: THREE.MeshStandardMaterial;
    }
  ) {
    const doorGroup = new THREE.Group();

    const frameGeom = new THREE.BoxGeometry(0.1, 2.2, 1.2);
    const frame = new THREE.Mesh(frameGeom, materials.frameMaterial);
    doorGroup.add(frame);

    const panelGeom = new THREE.BoxGeometry(0.06, 2.0, 0.52);
    const panelL = new THREE.Mesh(panelGeom, materials.glassMaterial);
    panelL.position.set(0.03, 0, 0.28);
    doorGroup.add(panelL);

    const panelR = new THREE.Mesh(panelGeom, materials.glassMaterial);
    panelR.position.set(0.03, 0, -0.28);
    doorGroup.add(panelR);

    const dividerGeom = new THREE.BoxGeometry(0.12, 2.2, 0.05);
    const divider = new THREE.Mesh(dividerGeom, materials.frameMaterial);
    doorGroup.add(divider);

    const barGeom = new THREE.CylinderGeometry(0.02, 0.02, 1.1, 8);
    const bar = new THREE.Mesh(barGeom, materials.accentMaterial);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(-0.1, -0.2, 0);
    doorGroup.add(bar);

    const stepGeom = new THREE.BoxGeometry(0.6, 0.1, 1.3);
    const step = new THREE.Mesh(stepGeom, materials.frameMaterial);
    step.position.set(-0.3, -1.1, 0);
    doorGroup.add(step);

    const lockGeom = new THREE.SphereGeometry(0.04, 16, 16);
    const lockMat = new THREE.MeshStandardMaterial({ color: 0x00ff00, emissive: 0x00ff00, emissiveIntensity: 1 });
    const lockIndicator = new THREE.Mesh(lockGeom, lockMat);
    lockIndicator.position.set(0.05, 0.5, 0.2);
    doorGroup.add(lockIndicator);

    doorGroup.position.set(xPos, -0.3, 1.22);
    this.doors.set(doorId, {
      group: doorGroup,
      isOpen: false,
      isHalfway: false,
      isLocked: false,
      targetX: xPos,
      currentX: xPos,
      lockIndicator
    });

    return doorGroup;
  }

  private createMockBus() {
    const group = new THREE.Group();

    // --- Materials ---
    const bodyMat = new THREE.MeshStandardMaterial({ 
      color: 0x7EC8E3, // YRT Sky Blue
      metalness: 0.4, 
      roughness: 0.3,
      envMapIntensity: 1
    });
    const glassMat = new THREE.MeshStandardMaterial({ 
      color: 0x111111, 
      transparent: true, 
      opacity: 0.8, 
      metalness: 0.9, 
      roughness: 0.1 
    });
    const plasticMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 1, roughness: 0.1 });
    const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2 });
    const tailLightMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 1 });
    const signalMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xffaa00, emissiveIntensity: 1 });

    // --- Main Body (Shell) ---
    const wallMat = bodyMat;
    
    // Floor
    const floorGeom = new THREE.BoxGeometry(9.75, 0.1, 2.98);
    const floor = new THREE.Mesh(floorGeom, plasticMat);
    floor.position.y = 0.1;
    floor.receiveShadow = true;
    group.add(floor);

    // Side Walls (Lower part)
    const sideWallGeom = new THREE.BoxGeometry(9.75, 1.2, 0.1);
    const leftWall = new THREE.Mesh(sideWallGeom, wallMat);
    leftWall.position.set(0, 0.7, 1.44);
    leftWall.castShadow = true;
    leftWall.receiveShadow = true;
    group.add(leftWall);
    
    const rightWall = leftWall.clone();
    rightWall.position.z = -1.44;
    group.add(rightWall);

    // Front & Back Panels
    const endWallGeom = new THREE.BoxGeometry(0.1, 3.45, 2.98);
    const frontWall = new THREE.Mesh(endWallGeom, wallMat);
    frontWall.position.x = 4.87;
    frontWall.position.y = 1.725;
    group.add(frontWall);
    
    const backWall = frontWall.clone();
    backWall.position.x = -4.87;
    group.add(backWall);

    // --- Roof ---
    const roofGeom = new THREE.BoxGeometry(9.75, 0.1, 2.98);
    const roof = new THREE.Mesh(roofGeom, bodyMat);
    roof.position.y = 3.4;
    group.add(roof);

    // --- Windows ---
    // Side Windows (Upper part)
    const sideWinGeom = new THREE.BoxGeometry(9.5, 1.8, 0.05);
    const sideWinL = new THREE.Mesh(sideWinGeom, glassMat);
    sideWinL.position.set(0, 2.2, 1.46);
    group.add(sideWinL);

    const sideWinR = sideWinL.clone();
    sideWinR.position.z = -1.46;
    group.add(sideWinR);

    // Windshield
    const windshieldGeom = new THREE.BoxGeometry(0.05, 2.0, 2.8);
    const windshield = new THREE.Mesh(windshieldGeom, glassMat);
    windshield.position.set(4.89, 2.0, 0);
    group.add(windshield);

    // --- Exterior Details ---
    // Indicators
    const indicatorPositions = [
      { x: 4.8, y: 1.0, z: 1.4, color: 0xffaa00 }, // Front Right
      { x: 4.8, y: 1.0, z: -1.4, color: 0xffaa00 }, // Front Left
      { x: -4.8, y: 1.0, z: 1.4, color: 0xffaa00 }, // Rear Right
      { x: -4.8, y: 1.0, z: -1.4, color: 0xffaa00 }  // Rear Left
    ];

    indicatorPositions.forEach(pos => {
      const light = new THREE.PointLight(pos.color, 0, 2);
      light.position.set(pos.x, pos.y, pos.z);
      group.add(light);
      this.busIndicators.push(light);

      // Visual indicator
      const indGeo = new THREE.BoxGeometry(0.05, 0.15, 0.3);
      const indMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
      const indMesh = new THREE.Mesh(indGeo, indMat);
      indMesh.position.set(pos.x + (pos.x > 0 ? 0.05 : -0.05), pos.y, pos.z);
      group.add(indMesh);

      const lensGeo = new THREE.PlaneGeometry(0.28, 0.13);
      const lensMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.3 });
      const lens = new THREE.Mesh(lensGeo, lensMat);
      lens.position.set(pos.x + (pos.x > 0 ? 0.08 : -0.08), pos.y, pos.z);
      lens.rotation.y = pos.x > 0 ? Math.PI / 2 : -Math.PI / 2;
      group.add(lens);
      indMesh.userData['lens'] = lens;
    });

    // Brake Lights
    const brakePositions = [
      { x: -4.8, y: 1.2, z: 0.8, color: 0xff0000 },
      { x: -4.8, y: 1.2, z: -0.8, color: 0xff0000 }
    ];

    brakePositions.forEach(pos => {
      const light = new THREE.PointLight(pos.color, 0, 3);
      light.position.set(pos.x, pos.y, pos.z);
      group.add(light);
      this.busBrakeLights.push(light);

      // Visual brake light
      const brakeGeo = new THREE.BoxGeometry(0.05, 0.3, 0.6);
      const brakeMat = new THREE.MeshStandardMaterial({ color: 0x330000 });
      const brakeMesh = new THREE.Mesh(brakeGeo, brakeMat);
      brakeMesh.position.set(pos.x - 0.05, pos.y, pos.z);
      group.add(brakeMesh);

      const lensGeo = new THREE.PlaneGeometry(0.58, 0.28);
      const lensMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.3 });
      const lens = new THREE.Mesh(lensGeo, lensMat);
      lens.position.set(pos.x - 0.08, pos.y, pos.z);
      lens.rotation.y = -Math.PI / 2;
      group.add(lens);
      brakeMesh.userData['lens'] = lens;
    });

    // Destination Sign (Front)
    const signGeom = new THREE.BoxGeometry(0.1, 0.5, 2.2);
    const signMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffaa00, emissiveIntensity: 0.8 });
    const sign = new THREE.Mesh(signGeom, signMat);
    sign.position.set(4.88, 3.1, 0);
    group.add(sign);

    // Wipers
    const wiperGeom = new THREE.BoxGeometry(0.02, 0.8, 0.02);
    const wiperL = new THREE.Mesh(wiperGeom, plasticMat);
    wiperL.name = 'wiper_l';
    wiperL.position.set(4.05, 0.2, 0.5);
    wiperL.rotation.z = -Math.PI / 12;
    group.add(wiperL);
    const wiperR = wiperL.clone();
    wiperR.name = 'wiper_r';
    wiperR.position.z = -0.5;
    group.add(wiperR);

    this.addInteractiveDoors(group, {
      accentMaterial: chromeMat,
      frameMaterial: plasticMat,
      glassMaterial: glassMat,
    });

    // Roof AC Unit
    const acGeom = new THREE.BoxGeometry(2, 0.4, 1.8);
    const acUnit = new THREE.Mesh(acGeom, bodyMat);
    acUnit.position.set(-1, 1.6, 0);
    group.add(acUnit);

    // License Plates
    const plateGeom = new THREE.PlaneGeometry(0.5, 0.25);
    const plateMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const frontPlate = new THREE.Mesh(plateGeom, plateMat);
    frontPlate.position.set(4.11, -1.2, 0);
    frontPlate.rotation.y = Math.PI / 2;
    group.add(frontPlate);

    const backPlate = frontPlate.clone();
    backPlate.position.set(-4.11, -1.2, 0);
    backPlate.rotation.y = -Math.PI / 2;
    group.add(backPlate);

    // Exhaust Pipe
    const exhaustGeom = new THREE.CylinderGeometry(0.08, 0.08, 0.4, 16);
    const exhaust = new THREE.Mesh(exhaustGeom, chromeMat);
    exhaust.position.set(-4, -1.3, -0.8);
    exhaust.rotation.z = Math.PI / 2;
    group.add(exhaust);

    // --- Interior Details ---
    const seatGeom = new THREE.BoxGeometry(0.4, 0.1, 0.5);
    const seatBackGeom = new THREE.BoxGeometry(0.05, 0.6, 0.5);
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x1e40af, roughness: 0.8 }); // Navy blue seats
    const seatBaseMat = new THREE.MeshStandardMaterial({ color: 0x444444 });

    // Passenger Seats
    for (let x = -3.2; x < 2; x += 1.1) {
      // Left side seats
      const seatL = new THREE.Group();
      const baseL = new THREE.Mesh(seatGeom, seatMat);
      seatL.add(baseL);
      const backL = new THREE.Mesh(seatBackGeom, seatMat);
      backL.position.set(-0.2, 0.3, 0);
      seatL.add(backL);
      const legL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.1), seatBaseMat);
      legL.position.y = -0.25;
      seatL.add(legL);
      
      seatL.position.set(x, -1.05, 0.8);
      group.add(seatL);

      // Right side seats
      const seatR = seatL.clone();
      seatR.position.z = -0.8;
      group.add(seatR);
    }

    // Driver Area
    const driverSeat = new THREE.Group();
    driverSeat.add(new THREE.Mesh(seatGeom, seatMat));
    const driverBack = new THREE.Mesh(seatBackGeom, seatMat);
    driverBack.position.set(-0.2, 0.3, 0);
    driverSeat.add(driverBack);
    driverSeat.position.set(2.8, -1.05, 0.7);
    group.add(driverSeat);

    const dashGeom = new THREE.BoxGeometry(0.8, 0.6, 2.3);
    const dash = new THREE.Mesh(dashGeom, plasticMat);
    dash.position.set(3.6, -0.9, 0);
    group.add(dash);

    const wheelRingGeom = new THREE.TorusGeometry(0.18, 0.02, 8, 24);
    const steeringWheel = new THREE.Mesh(wheelRingGeom, plasticMat);
    steeringWheel.position.set(3.2, -0.5, 0.7);
    steeringWheel.rotation.y = Math.PI / 2;
    steeringWheel.rotation.x = Math.PI / 3;
    group.add(steeringWheel);

    // Interior Lighting
    const interiorLight = new THREE.PointLight(0xffffff, 0.6, 10);
    interiorLight.position.set(0, 1, 0);
    group.add(interiorLight);

    const interiorLight2 = interiorLight.clone();
    interiorLight2.position.set(3, 1, 0);
    group.add(interiorLight2);

    // --- Bumpers & Trim ---
    const bumperGeom = new THREE.BoxGeometry(0.4, 0.5, 2.6);
    const frontBumper = new THREE.Mesh(bumperGeom, plasticMat);
    frontBumper.position.set(3.9, -1.2, 0);
    group.add(frontBumper);

    const rearBumper = new THREE.Mesh(bumperGeom, plasticMat);
    rearBumper.position.set(-3.9, -1.2, 0);
    group.add(rearBumper);

    // --- Lights ---
    const headLightGeom = new THREE.CircleGeometry(0.2, 16);
    const headLightL = new THREE.Mesh(headLightGeom, lightMat);
    headLightL.position.set(4.01, -0.8, 0.8);
    headLightL.rotation.y = Math.PI / 2;
    group.add(headLightL);

    const headLightR = headLightL.clone();
    headLightR.position.z = -0.8;
    group.add(headLightR);

    const tailLightGeom = new THREE.PlaneGeometry(0.2, 0.6);
    const tailLightL = new THREE.Mesh(tailLightGeom, tailLightMat);
    tailLightL.position.set(-4.01, -0.8, 0.9);
    tailLightL.rotation.y = -Math.PI / 2;
    group.add(tailLightL);

    const tailLightR = tailLightL.clone();
    tailLightR.position.z = -0.9;
    group.add(tailLightR);

    // Turn Signals (Front & Side)
    const signalGeom = new THREE.BoxGeometry(0.05, 0.15, 0.3);
    const signalFL = new THREE.Mesh(signalGeom, signalMat);
    signalFL.position.set(4.01, -0.8, 1.1);
    group.add(signalFL);
    const signalFR = signalFL.clone();
    signalFR.position.z = -1.1;
    group.add(signalFR);

    // Side Reflectors
    const reflectorGeom = new THREE.BoxGeometry(0.2, 0.05, 0.02);
    for (let x = -3; x <= 3; x += 2) {
      const refL = new THREE.Mesh(reflectorGeom, signalMat);
      refL.position.set(x, -1.1, 1.25);
      group.add(refL);
      const refR = refL.clone();
      refR.position.z = -1.25;
      group.add(refR);
    }

    // Mud Flaps
    const flapGeom = new THREE.BoxGeometry(0.05, 0.6, 0.6);
    const flapMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const flapRL = new THREE.Mesh(flapGeom, flapMat);
    flapRL.position.set(-3.8, 0.3, 1.3);
    group.add(flapRL);
    const flapRR = flapRL.clone();
    flapRR.position.z = -1.3;
    group.add(flapRR);

    // --- Wheels ---
    const wheelGeom = new THREE.CylinderGeometry(0.55, 0.55, 0.4, 32);
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1 });
    const rimGeom = new THREE.CylinderGeometry(0.35, 0.35, 0.42, 16);
    
    const wheelPositions = [
      [-3.2, 0.55, 1.3], [3.2, 0.55, 1.3],
      [-3.2, 0.55, -1.3], [3.2, 0.55, -1.3]
    ];

    wheelPositions.forEach((pos) => {
      const wheelGroup = new THREE.Group();
      
      const tire = new THREE.Mesh(wheelGeom, tireMat);
      tire.rotation.x = Math.PI / 2;
      tire.castShadow = true;
      wheelGroup.add(tire);

      const rim = new THREE.Mesh(rimGeom, chromeMat);
      rim.rotation.x = Math.PI / 2;
      wheelGroup.add(rim);

      wheelGroup.position.set(pos[0], pos[1], pos[2]);
      group.add(wheelGroup);
    });

    // --- Mirrors ---
    const mirrorArmGeom = new THREE.BoxGeometry(0.1, 0.1, 0.6);
    const mirrorHeadGeom = new THREE.BoxGeometry(0.2, 0.5, 0.3);
    
    const mirrorL = new THREE.Group();
    const armL = new THREE.Mesh(mirrorArmGeom, plasticMat);
    armL.position.z = 0.3;
    mirrorL.add(armL);
    const headL = new THREE.Mesh(mirrorHeadGeom, plasticMat);
    headL.position.set(0, 0, 0.6);
    mirrorL.add(headL);
    mirrorL.position.set(3.5, 0.8, 1.25);
    group.add(mirrorL);

    const mirrorR = mirrorL.clone();
    mirrorR.scale.z = -1;
    mirrorR.position.z = -1.25;
    group.add(mirrorR);

    // --- Hotspot Indicators ---
    this.addHotspotsToModel(group);

    group.position.copy(this.parkedBusPosition);
    this.baseBusPosition.copy(group.position);
    this.busModel = group;
    this.scene.add(group);
  }

  private addHotspotIndicator(parent: THREE.Group, pos: [number, number, number], id: string, color: number) {
    const group = new THREE.Group();
    
    // Core sphere
    const geom = new THREE.SphereGeometry(0.2, 16, 16);
    const mat = new THREE.MeshStandardMaterial({ 
      color, 
      emissive: color, 
      emissiveIntensity: 1,
      transparent: true,
      opacity: 0.8
    });
    const mesh = new THREE.Mesh(geom, mat);
    group.add(mesh);

    // Outer glow ring
    const ringGeom = new THREE.TorusGeometry(0.35, 0.02, 8, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4 });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    group.position.set(pos[0], pos[1], pos[2]);
    group.name = `hotspot_${id}`;
    group.userData = { hotspotId: id };
    this.hotspots.push(group);
    
    // Add interaction mesh (larger invisible box for easier clicking)
    const hitGeom = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitMesh = new THREE.Mesh(hitGeom, hitMat);
    hitMesh.name = `hotspot_${id}`;
    hitMesh.userData = { hotspotId: id };
    group.add(hitMesh);

    parent.add(group);
  }

  private startCinematicIntro() {
    if (!this.busModel || !this.camera || !this.controls) return;

    this.clearIntroFallback();
    this.introPhase = 'driving';
    this.introProgress = 0;
    
    // Initial positions for cinematic start
    this.busModel.position.set(this.baseBusPosition.x, this.baseBusPosition.y, this.introStartZ);
    this.camera.position.set(0, 8, 30); // High cinematic angle
    this.controls.target.set(0, 1, 0);

    // Headless browsers and throttled tabs can stall RAF-driven intro logic.
    this.introFallbackTimeout = window.setTimeout(() => this.completeIntro(), 6000);
  }

  private clearIntroFallback() {
    if (this.introFallbackTimeout !== null) {
      window.clearTimeout(this.introFallbackTimeout);
      this.introFallbackTimeout = null;
    }
  }

  private completeIntro() {
    if (this.introPhase === 'complete') return;

    this.clearIntroFallback();
    this.introPhase = 'complete';
    this.introProgress = 0;

    if (this.busModel) {
      this.busModel.position.copy(this.baseBusPosition);
    }

    this.introComplete.next();
  }

  private animate() {
    if (!isPlatformBrowser(this.platformId) || !this.renderer || !this.controls) return;
    
    this.animationId = requestAnimationFrame(this.animate.bind(this));
    
    const time = Date.now() * 0.002;

    // --- Intro Animation Logic ---
    if (this.introPhase === 'driving') {
      this.introProgress += 0.015; // Faster driving
      
      // Drive Bus In
      if (this.busModel) {
        this.busModel.position.z = THREE.MathUtils.lerp(
          this.introStartZ,
          this.baseBusPosition.z,
          Math.min(1, this.introProgress * 1.2)
        );
        
        // Camera Follow
        this.camera.position.x = THREE.MathUtils.lerp(0, 12, this.introProgress);
        this.camera.position.y = THREE.MathUtils.lerp(8, 5, this.introProgress);
        this.camera.position.z = THREE.MathUtils.lerp(30, 12, this.introProgress);
        
        if (this.introProgress >= 0.85) {
          this.introPhase = 'parking';
          this.introProgress = 0;
        }
      }
    } else if (this.introPhase === 'parking') {
      this.introProgress += 0.15; // Faster parking
      // Suspension Bounce
      if (this.busModel) {
        this.busModel.position.y =
          this.baseBusPosition.y + Math.sin(this.introProgress) * 0.05 * Math.exp(-this.introProgress * 0.5);
      }
      
      if (this.introProgress > 10) {
        this.completeIntro();
      }
    }

    // --- Inspector Idle Animation ---
    if (this.inspector) {
      this.inspector.rotation.y = this.inspectorBaseRotationY + Math.sin(time * 0.5) * 0.2;
      // Keep the idle sway relative to the placed position instead of snapping the model to world zero.
      this.inspector.position.y = this.inspectorBasePosition.y + Math.sin(time * 2) * 0.01;
    }

    // --- Windshield Wipers ---
    if (this.busModel) {
      const wiperAngle = Math.sin(time * 2) * 0.5;
      this.busModel.traverse(obj => {
        if (obj.name === 'wiper_l') {
          obj.rotation.z = -Math.PI / 12 + wiperAngle;
        } else if (obj.name === 'wiper_r') {
          obj.rotation.z = -Math.PI / 12 + wiperAngle;
        }
      });
    }

    // --- Trolley Movement ---
    if (this.trolley && this.introPhase === 'complete') {
      // Slowly roll trolley into position if it's not already there
      const targetX = -6.5;
      if (Math.abs(this.trolley.position.x - targetX) > 0.01) {
        this.trolley.position.x = THREE.MathUtils.lerp(this.trolley.position.x, targetX, 0.02);
      }
    }

    // Animate Hotspots (Pulse)
    this.hotspots.forEach(hotspot => {
      const pulse = 1 + Math.sin(time) * 0.1;
      hotspot.scale.set(pulse, pulse, pulse);
      
      // Rotate the ring
      const ring = hotspot.children[1] as THREE.Mesh;
      if (ring) {
        ring.rotation.z += 0.01;
      }
    });

    // Animate Doors
    this.doors.forEach((door) => {
      const step = 0.05;
      if (Math.abs(door.currentX - door.targetX) > 0.01) {
        if (door.currentX < door.targetX) door.currentX += step;
        else door.currentX -= step;
        door.group.position.x = door.currentX;
      }
    });

    this.controls.update();
    // Animate overhead lights flickering
    if (this.introPhase === 'driving' || this.introPhase === 'parking') {
      this.flickerTimer += 0.1;
      this.overheadLights.forEach((light, i) => {
        const flicker = Math.sin(this.flickerTimer * (i + 1)) > 0.8 ? 0 : 0.8;
        light.intensity = flicker;
        // Update visual glow if available
        const parent = light.parent;
        if (parent) {
          parent.children.forEach(child => {
            if (child.userData['glow']) {
              (child as THREE.Mesh).visible = flicker > 0;
            }
          });
        }
      });
    } else {
      // Subtle pulse when complete
      this.flickerTimer += 0.02;
      this.overheadLights.forEach(light => {
        light.intensity = 0.8 + Math.sin(this.flickerTimer) * 0.1;
      });
    }

    // Animate bus lights
    if (this.introPhase === 'driving' || this.introPhase === 'parking') {
      this.indicatorTimer += 0.05;
      const indicatorOn = Math.floor(this.indicatorTimer % 2) === 0;
      this.busIndicators.forEach(light => {
        light.intensity = indicatorOn ? 2 : 0;
        // Update lens opacity
        const parent = light.parent;
        if (parent) {
          parent.children.forEach(child => {
            if (child.userData['lens'] && child.type === 'Mesh') {
              const mesh = child as THREE.Mesh;
              const mat = mesh.material as THREE.MeshBasicMaterial;
              mat.opacity = indicatorOn ? 0.8 : 0.2;
            }
          });
        }
      });

      // Brake lights on when parking
      if (this.introPhase === 'parking') {
        this.busBrakeLights.forEach(light => {
          const intensity = 3 + Math.sin(Date.now() * 0.01) * 1;
          light.intensity = intensity;
          const parent = light.parent;
          if (parent) {
            parent.children.forEach(child => {
              if (child.userData['lens'] && child.type === 'Mesh') {
                const mesh = child as THREE.Mesh;
                const mat = mesh.material as THREE.MeshBasicMaterial;
                mat.opacity = 0.8;
              }
            });
          }
        });
      }
    } else {
      this.busIndicators.forEach(light => {
        light.intensity = 0;
        const parent = light.parent;
        if (parent) {
          parent.children.forEach(child => {
            if (child.userData['lens'] && child.type === 'Mesh') {
              const mesh = child as THREE.Mesh;
              const mat = mesh.material as THREE.MeshBasicMaterial;
              mat.opacity = 0.2;
            }
          });
        }
      });
      this.busBrakeLights.forEach(light => {
        light.intensity = 0;
        const parent = light.parent;
        if (parent) {
          parent.children.forEach(child => {
            if (child.userData['lens'] && child.type === 'Mesh') {
              const mesh = child as THREE.Mesh;
              const mat = mesh.material as THREE.MeshBasicMaterial;
              mat.opacity = 0.2;
            }
          });
        }
      });
    }

    this.renderer.render(this.scene, this.camera);
  }

  toggleDoor(id: string, mode: 'full' | 'half' | 'close' = 'full') {
    const doorId = id === 'front' ? 'front_door' : (id === 'curb_side' ? 'middle_door' : null);
    if (!doorId) return;

    const door = this.doors.get(doorId);
    if (door) {
      if (door.isLocked && mode !== 'close') return; // Cannot open if locked

      const originalX = doorId === 'front_door' ? 2.5 : -1;
      
      if (mode === 'close') {
        door.isOpen = false;
        door.isHalfway = false;
        door.targetX = originalX;
      } else if (mode === 'half') {
        door.isOpen = false;
        door.isHalfway = true;
        door.targetX = originalX + 0.4;
      } else {
        door.isOpen = true;
        door.isHalfway = false;
        door.targetX = originalX + 0.8;
      }
    }
  }

  toggleLock(id: string) {
    const doorId = id === 'front' ? 'front_door' : (id === 'curb_side' ? 'middle_door' : null);
    if (!doorId) return;

    const door = this.doors.get(doorId);
    if (door) {
      // Only lock if closed
      if (Math.abs(door.currentX - (doorId === 'front_door' ? 2.5 : -1)) > 0.01) return;

      door.isLocked = !door.isLocked;
      const color = door.isLocked ? 0xff0000 : 0x00ff00;
      (door.lockIndicator.material as THREE.MeshStandardMaterial).color.setHex(color);
      (door.lockIndicator.material as THREE.MeshStandardMaterial).emissive.setHex(color);
    }
  }

  getDoorState(id: string) {
    const doorId = id === 'front' ? 'front_door' : (id === 'curb_side' ? 'middle_door' : null);
    if (!doorId) return null;
    const door = this.doors.get(doorId);
    return door ? { 
      isOpen: door.isOpen, 
      isHalfway: door.isHalfway, 
      isLocked: door.isLocked 
    } : null;
  }

  toggleNightMode() {
    this.isNightMode = !this.isNightMode;
    const bgColor = this.isNightMode ? 0x020617 : 0x0f172a;
    this.scene.background = new THREE.Color(bgColor);
    this.scene.fog = new THREE.Fog(bgColor, 20, 60);
    
    // Update emissive intensities
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
        if (obj.material.emissiveIntensity > 0) {
          obj.material.emissiveIntensity = this.isNightMode ? 5 : 1;
        }
      }
    });
  }

  getNightMode(): boolean {
    return this.isNightMode;
  }

  getDoorStatus(id: string): boolean {
    const doorId = id === 'front' ? 'front_door' : (id === 'curb_side' ? 'middle_door' : null);
    if (!doorId) return false;
    return this.doors.get(doorId)?.isOpen || false;
  }

  private syncRendererSize(containerEl: HTMLDivElement) {
    if (!isPlatformBrowser(this.platformId) || !this.camera || !this.renderer) return;

    const rect = containerEl.getBoundingClientRect();
    const width = Math.round(rect.width || containerEl.clientWidth);
    const height = Math.round(rect.height || containerEl.clientHeight);
    if (width <= 0 || height <= 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private onResize(container: ElementRef<HTMLDivElement>) {
    this.syncRendererSize(container.nativeElement);
  }

  private onMouseMove(event: MouseEvent) {
    if (!this.renderer || !this.camera || this.introPhase !== 'complete') return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);
    const intersects = this.raycaster.intersectObjects(this.scene.children, true);

    let hoveredId: string | null = null;
    for (const intersect of intersects) {
      if (intersect.object.userData['hotspotId']) {
        hoveredId = intersect.object.userData['hotspotId'];
        break;
      }
    }
    
    this.hotspotHovered.next(hoveredId);
    
    // Change cursor
    this.renderer.domElement.style.cursor = hoveredId ? 'pointer' : 'move';
  }

  private onClick(event: MouseEvent) {
    if (!isPlatformBrowser(this.platformId) || !this.renderer) return;
    
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.scene.children, true);

    for (const intersect of intersects) {
      if (intersect.object.userData['hotspotId']) {
        this.hotspotClicked.next(intersect.object.userData['hotspotId']);
        break;
      }
    }
  }

  setCameraPreset(preset: string) {
    if (!isPlatformBrowser(this.platformId) || !this.controls) return;
    
    switch (preset) {
      case 'front':
        this.camera.position.set(10, 2, 0);
        this.controls.target.set(4.8, 1.5, 0);
        break;
      case 'rear':
        this.camera.position.set(-10, 2, 0);
        this.controls.target.set(-4.8, 1.5, 0);
        break;
      case 'left':
        this.camera.position.set(0, 2, -10);
        this.controls.target.set(0, 1.5, 0);
        break;
      case 'right':
        this.camera.position.set(0, 2, 10);
        this.controls.target.set(0, 1.5, 0);
        break;
      case 'top':
        this.camera.position.set(0, 12, 0);
        this.controls.target.set(0, 0, 0);
        break;
      case 'interior':
        this.camera.position.set(3.5, 1.5, 0);
        this.controls.target.set(4.8, 1.5, 0);
        break;
      case 'driver':
        this.camera.position.set(4.0, 1.8, 0.8);
        this.controls.target.set(4.8, 1.5, 0.8);
        break;
      case 'undercarriage':
        this.camera.position.set(3.2, -1.0, 3.2);
        this.controls.target.set(3.2, 0.5, 0);
        break;
      case 'fly-in':
        this.camera.position.set(0, 5, 25);
        this.controls.target.set(0, 1.5, 0);
        this.camera.fov = 24;
        this.camera.updateProjectionMatrix();
        break;
      case 'hero':
        this.camera.position.set(12, 5, 12);
        this.controls.target.set(0, 1.5, 0);
        this.camera.fov = 35;
        this.camera.updateProjectionMatrix();
        break;
      case 'inspector-pov':
        this.camera.position.set(-5, 1.7, 5);
        this.controls.target.set(0, 1.5, 0);
        this.camera.fov = 70;
        this.camera.updateProjectionMatrix();
        break;
      case 'left-panel':
        this.camera.position.set(-8, 1.5, 8);
        this.controls.target.set(-8, 1.5, 4);
        this.camera.fov = 70;
        this.camera.updateProjectionMatrix();
        break;
      case 'issue-cards':
        this.camera.position.set(8, 1.5, 8);
        this.controls.target.set(8, 1.5, 4);
        this.camera.fov = 70;
        this.camera.updateProjectionMatrix();
        break;
      case 'drone':
        this.camera.position.set(0, 20, 0);
        this.controls.target.set(0, 0, 0);
        this.camera.fov = 24;
        this.camera.updateProjectionMatrix();
        break;
      case 'closing':
        this.camera.position.set(15, 8, 15);
        this.controls.target.set(0, 0, 0);
        this.camera.fov = 24;
        this.camera.updateProjectionMatrix();
        break;
      case 'turntable':
        this.camera.position.set(10, 2, 10);
        this.controls.target.set(0, 1.5, 0);
        this.camera.fov = 35;
        this.camera.updateProjectionMatrix();
        break;
      case 'team-wide':
        this.camera.position.set(15, 5, 15);
        this.controls.target.set(0, 1.5, 0);
        this.camera.fov = 24;
        this.camera.updateProjectionMatrix();
        break;
      case 'supervisor':
        this.camera.position.set(-9, 1.7, 5);
        this.controls.target.set(-8, 1.5, 4);
        this.camera.fov = 70;
        this.camera.updateProjectionMatrix();
        break;
      case 'undercarriage-inspection':
        this.camera.position.set(-5, 0.5, 2);
        this.controls.target.set(-2, 0.5, 0);
        this.camera.fov = 35;
        this.camera.updateProjectionMatrix();
        break;
    }
    this.controls.update();
  }

  ngOnDestroy() {
    if (!isPlatformBrowser(this.platformId)) return;
    
    this.clearIntroFallback();
    if (this.animationId) cancelAnimationFrame(this.animationId);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.renderer?.dispose();
    this.scene?.clear();
    if (this.onResizeBound) {
      window.removeEventListener('resize', this.onResizeBound);
    }
  }
}
