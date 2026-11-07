/* =========================================================
   PHOTOREALISTIC 3D GLOWING SATURN & NEBULA (WEBGL / THREE.JS)
   - Procedural high-resolution latitudinal atmospheric cloud banding
   - Multi-lane tilted ring system with Cassini division & radial UVs
   - Volumetric glowing amber nebula & celestial starfield
   - Modern Web Guidance: Efficient background processing & pausing
   ========================================================= */

let scene = null;
let camera = null;
let renderer = null;
let animId = null;
let saturnMesh = null;
let ringMesh = null;
let nebulaMesh = null;
let starPoints = null;
let saturnGroup = null;
// Animation loop tracking
let isRunning = false;
let currentCanvas = null;

/**
 * Creates high-fidelity procedural Saturn latitudinal cloud bands
 */
function createSaturnBandTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");

    // Atmospheric palette matching NASA Cassini & Hubble observations
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0.00, "#4a5b63"); // North polar hexagon veil
    grad.addColorStop(0.07, "#6b7773");
    grad.addColorStop(0.16, "#9e917d");
    grad.addColorStop(0.24, "#baa588");
    grad.addColorStop(0.33, "#cfba95");
    grad.addColorStop(0.42, "#dfca9f");
    grad.addColorStop(0.48, "#e7d5ad"); // Bright tropical zone
    grad.addColorStop(0.50, "#c49866"); // Equatorial brown-amber jet
    grad.addColorStop(0.52, "#e5cf9f");
    grad.addColorStop(0.60, "#cbb189");
    grad.addColorStop(0.72, "#b29571");
    grad.addColorStop(0.84, "#8a755b");
    grad.addColorStop(1.00, "#56483b"); // South polar region
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Micro-storm filaments and latitudinal striations
    for (let y = 0; y < canvas.height; y += 2) {
        const factor = (Math.sin(y * 0.14) * 0.5 + 0.5) * (Math.cos(y * 0.04) * 0.5 + 0.5);
        ctx.fillStyle = `rgba(255, 245, 220, ${factor * 0.07})`;
        ctx.fillRect(0, y, canvas.width, 1);
        ctx.fillStyle = `rgba(35, 22, 12, ${factor * 0.05})`;
        ctx.fillRect(0, y + 1, canvas.width, 1);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
}

/**
 * Creates authentic multi-lane ring texture (C-Ring, B-Ring, Cassini, A-Ring)
 */
function createSaturnRingTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");

    // Linear gradient across radius (x: 0 = inner boundary, 1024 = outer boundary)
    const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
    // Inner gap
    grad.addColorStop(0.00, "rgba(0, 0, 0, 0)");
    // C-Ring (Crepe Ring, faint dusky veil)
    grad.addColorStop(0.04, "rgba(130, 95, 60, 0.12)");
    grad.addColorStop(0.18, "rgba(175, 135, 95, 0.32)");
    grad.addColorStop(0.22, "rgba(90, 65, 40, 0.08)");
    // B-Ring (Main, densest, brightest golden band)
    grad.addColorStop(0.23, "rgba(240, 205, 150, 0.90)");
    grad.addColorStop(0.40, "rgba(255, 225, 175, 0.98)");
    grad.addColorStop(0.54, "rgba(230, 190, 135, 0.94)");
    grad.addColorStop(0.63, "rgba(205, 160, 110, 0.85)");
    // Cassini Division (Dark division gap)
    grad.addColorStop(0.640, "rgba(10, 8, 6, 0.04)");
    grad.addColorStop(0.680, "rgba(2, 2, 2, 0.00)");
    grad.addColorStop(0.685, "rgba(10, 8, 6, 0.04)");
    // A-Ring (Outer ring with Encke gap)
    grad.addColorStop(0.690, "rgba(215, 175, 125, 0.82)");
    grad.addColorStop(0.820, "rgba(225, 185, 135, 0.76)");
    grad.addColorStop(0.910, "rgba(180, 140, 95, 0.65)");
    // Encke division
    grad.addColorStop(0.925, "rgba(20, 15, 10, 0.08)");
    grad.addColorStop(0.940, "rgba(175, 130, 85, 0.48)");
    grad.addColorStop(0.980, "rgba(130, 90, 55, 0.18)");
    grad.addColorStop(1.000, "rgba(0, 0, 0, 0)");

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Fine particle streaks
    for (let x = 0; x < canvas.width; x += 2) {
        const noise = Math.sin(x * 0.35) * 0.5 + 0.5;
        ctx.fillStyle = `rgba(255, 255, 255, ${noise * 0.05})`;
        ctx.fillRect(x, 0, 1, canvas.height);
    }

    const tex = new THREE.CanvasTexture(canvas);
    return tex;
}

/**
 * Builds RingGeometry with UV coordinates mapped along the radial axis
 */
function createRadialRingGeometry(innerRadius, outerRadius, thetaSegments) {
    const geometry = new THREE.RingGeometry(innerRadius, outerRadius, thetaSegments);
    const pos = geometry.attributes.position;
    const uv = geometry.attributes.uv;

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const distance = Math.sqrt(x * x + y * y);
        const norm = (distance - innerRadius) / (outerRadius - innerRadius);
        uv.setXY(i, Math.max(0, Math.min(1, norm)), 0.5);
    }
    uv.needsUpdate = true;
    return geometry;
}

/**
 * Creates atmospheric glowing nebula texture for background depth
 */
function createNebulaTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");

    // Center radiant nebula core
    const grad = ctx.createRadialGradient(256, 256, 10, 256, 256, 256);
    grad.addColorStop(0.00, "rgba(235, 165, 75, 0.35)"); // Golden core
    grad.addColorStop(0.35, "rgba(180, 105, 45, 0.20)");
    grad.addColorStop(0.65, "rgba(90, 45, 110, 0.10)"); // Cosmic violet
    grad.addColorStop(1.00, "rgba(0, 0, 0, 0)");

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const tex = new THREE.CanvasTexture(canvas);
    return tex;
}

/**
 * Main animation loop with performance throttle
 * Strictly stationary & pinned to left (non-dynamic, no mouse tracking)
 */
function animate() {
    if (!isRunning) return;
    animId = requestAnimationFrame(animate);

    // Majestic slow axial drift of the ring structure
    if (ringMesh) {
        ringMesh.rotation.z += 0.00012;
    }

    if (starPoints) {
        starPoints.rotation.y += 0.00005;
    }

    if (renderer && scene && camera) {
        renderer.render(scene, camera);
    }
}

let _threePromise = null;
function ensureThreeJS() {
    if (typeof THREE !== "undefined") return Promise.resolve(THREE);
    if (_threePromise) return _threePromise;
    _threePromise = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "/vendor/three/three.min.js";
        s.async = true;
        s.onload = () => {
            if (typeof THREE !== "undefined") resolve(THREE);
            else reject(new Error("Three.js loaded but undefined"));
        };
        s.onerror = () => {
            _threePromise = null;
            reject(new Error("Failed to load Three.js from vendor"));
        };
        document.head.appendChild(s);
    });
    return _threePromise;
}

/**
 * Starts or mounts the 3D Saturn WebGL experience
 */
export function startSaturnWebGL(container) {
    if (/Android/i.test(navigator.userAgent) || (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(max-width: 768px)").matches)) {
        return;
    }

    if (typeof THREE === "undefined") {
        ensureThreeJS()
            .then(() => startSaturnWebGL(container))
            .catch(err => console.warn("[SATURN-3D] Could not load Three.js on demand:", err));
        return;
    }

    if (!container) return;

    // Clean up previous instance if exists
    destroySaturnWebGL();

    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;

    // 1. Scene & Camera
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
    camera.position.set(0, 0, 7.5);

    // 2. Renderer
    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance"
    });
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h);
    renderer.setClearColor(0x000000, 0); // Transparent canvas

    currentCanvas = renderer.domElement;
    currentCanvas.id = "saturnCanvas";
    currentCanvas.style.cssText = "position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1;";
    container.appendChild(currentCanvas);

    // 3. Lighting
    // Warm Sun Directional Light (illuminates the right limb and ring plane)
    const sunLight = new THREE.DirectionalLight(0xffedd5, 2.8);
    sunLight.position.set(6, 4, 5);
    scene.add(sunLight);

    // Ambient space twilight
    const ambientLight = new THREE.AmbientLight(0x181424, 0.75);
    scene.add(ambientLight);

    // Atmospheric rim back-light
    const rimLight = new THREE.DirectionalLight(0x8a50c8, 1.0);
    rimLight.position.set(-6, -2, -4);
    scene.add(rimLight);

    // 4. Saturn Rings Master Group - DEEP IN SPACE, PINNED TO LEFT & STATIONARY
    saturnGroup = new THREE.Group();
    const isMobile = w < 600;
    if (isMobile) {
        // Mobile: rings anchored on left of phone screen, sweeping across view
        saturnGroup.position.set(-1.3, 0.0, -3.2);
        saturnGroup.scale.set(0.60, 0.60, 0.60);
    } else {
        // Desktop: rings pinned to left, sweeping across background below text
        saturnGroup.position.set(-4.8, -0.2, -4.0);
        saturnGroup.scale.set(1.0, 1.0, 1.0);
    }

    // Majestic cosmic tilt: rings sweep diagonally, framing the view cleanly
    saturnGroup.rotation.x = 0.50;
    saturnGroup.rotation.y = 0.30;
    saturnGroup.rotation.z = 0.15;
    scene.add(saturnGroup);

    // 5. Expansive Multi-lane Saturn Rings (ONLY rings visible, planet hidden)
    const ringInner = 2.0;
    const ringOuter = 9.2;
    const ringGeo = createRadialRingGeometry(ringInner, ringOuter, 180);
    const ringTex = createSaturnRingTexture();
    const ringMat = new THREE.MeshStandardMaterial({
        map: ringTex,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.92,
        roughness: 0.55,
        metalness: 0.14
    });
    ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = Math.PI / 2; // Lie on planetary equator
    saturnGroup.add(ringMesh);

    // 8. Glowing Volumetric Nebula Backdrop
    const nebulaTex = createNebulaTexture();
    const nebulaGeo = new THREE.PlaneGeometry(16, 12);
    const nebulaMat = new THREE.MeshBasicMaterial({
        map: nebulaTex,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    nebulaMesh = new THREE.Mesh(nebulaGeo, nebulaMat);
    nebulaMesh.position.set(-4.5, 0.4, -6.0);
    scene.add(nebulaMesh);

    // 9. Twinkling Celestial Starfield (responsive viewport spread)
    const starCount = 320;
    const starPositions = new Float32Array(starCount * 3);
    const spreadX = isMobile ? 8 : 22;
    const spreadY = isMobile ? 18 : 16;
    for (let i = 0; i < starCount * 3; i += 3) {
        starPositions[i] = (Math.random() - 0.5) * spreadX;
        starPositions[i + 1] = (Math.random() - 0.5) * spreadY;
        starPositions[i + 2] = -3 - Math.random() * 8;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.05,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending
    });
    starPoints = new THREE.Points(starGeo, starMat);
    scene.add(starPoints);

    // 10. Modern Web Guidance: Visibility observer & resize containment (NO mouse parallax)
    window.addEventListener("resize", handleResize, { passive: true });
    document.addEventListener("visibilitychange", handleVisibilityChange);

    isRunning = true;
    animate();
}

function handleResize() {
    if (!renderer || !camera || !currentCanvas) return;
    const parent = currentCanvas.parentElement;
    if (!parent) return;

    const w = parent.clientWidth || window.innerWidth;
    const h = parent.clientHeight || window.innerHeight;

    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);

    if (saturnGroup) {
        if (w < 600) {
            saturnGroup.position.set(-1.3, 0.0, -3.2);
            saturnGroup.scale.set(0.60, 0.60, 0.60);
        } else {
            saturnGroup.position.set(-4.8, -0.2, -4.0);
            saturnGroup.scale.set(1.0, 1.0, 1.0);
        }
    }
}

function handleVisibilityChange() {
    if (document.visibilityState === "hidden") {
        pauseSaturnWebGL();
    } else {
        const shell = document.getElementById("appShell");
        if (shell && shell.classList.contains("is-start-page")) {
            resumeSaturnWebGL();
        }
    }
}

export function pauseSaturnWebGL() {
    isRunning = false;
    if (animId) {
        cancelAnimationFrame(animId);
        animId = null;
    }
}

export function resumeSaturnWebGL() {
    if (!isRunning && scene && renderer && camera) {
        isRunning = true;
        animate();
    }
}

export function destroySaturnWebGL() {
    pauseSaturnWebGL();

    window.removeEventListener("resize", handleResize);
    document.removeEventListener("visibilitychange", handleVisibilityChange);

    if (currentCanvas && currentCanvas.parentElement) {
        currentCanvas.parentElement.removeChild(currentCanvas);
    }
    currentCanvas = null;

    if (renderer) {
        renderer.dispose();
        renderer = null;
    }

    scene = null;
    camera = null;
    saturnMesh = null;
    ringMesh = null;
    nebulaMesh = null;
    starPoints = null;
    saturnGroup = null;
}
