import * as THREE from "./assets/vendor/three.module.min.js";
import { SITE_CONFIG } from "./config.js";

// 以冷白和星光白为主，少量琥珀与淡紫，避免星空变成彩色噪点
const STAR_TINTS = [
    [0.72, 0.84, 1.0],
    [0.9, 0.95, 1.0],
    [1.0, 0.98, 0.94],
    [1.0, 0.97, 0.92],
    [1.0, 0.86, 0.7],
    [0.86, 0.82, 1.0],
];

// 轻微鱼眼：视口当作一枚广角镜片，中心略放大、边缘渐压缩。
// 畸变在各顶点着色器里完成，不经过离屏后处理，
// 从而保持与里程碑一致的加法混合与发光色彩。
const FISHEYE_STRENGTH = 0.2;
const fisheyeAspectUniform = { value: 1 };
// 远景（银河/星河/深空星）的镜片弯曲收敛一些：让它们保持平坦遥远，
// 近景星层与月亮吃满畸变，强化前后距离感。
const FISHEYE_LAYER_WEIGHTS = {
    moonNear: 1,
    near: 1,
    mid: 0.85,
    far: 0.6,
    deep: 0.6,
};
function createFisheyeUniforms(weight = 1) {
    return {
        uFisheyeStrength: { value: FISHEYE_STRENGTH * weight },
        uFisheyeAspect: fisheyeAspectUniform,
    };
}
// 月亮靠近画幅边缘：窄屏时降低它的镜片权重，避免被鱼眼推出屏幕
function moonFisheyeWeight(aspect) {
    const narrowness = Math.min(Math.max((1.82 - aspect) / 1.08, 0), 1);
    return 1 - narrowness * 0.5;
}
const moonFisheyeUniforms = createFisheyeUniforms(moonFisheyeWeight(1.6));
const FISHEYE_VERTEX_GLSL = /* glsl */ `
    uniform float uFisheyeStrength;
    uniform float uFisheyeAspect;

    vec2 fisheyeDisplay(vec2 p, out float magnification) {
        float maxR = length(vec2(uFisheyeAspect, 1.0));
        float sourceR = clamp(length(vec2(p.x * uFisheyeAspect, p.y)) / maxR, 0.0, 1.0);
        float displayR = sourceR;
        for (int i = 0; i < 3; i++) {
            float scale = 1.0 - uFisheyeStrength * (1.0 - displayR * displayR);
            displayR = sourceR / max(scale, 1e-3);
        }
        magnification = sourceR > 1e-6 ? displayR / sourceR : 1.0;
        return p * magnification;
    }

    vec4 fisheyeClip(vec4 clip) {
        float magnification;
        return vec4(fisheyeDisplay(clip.xy / clip.w, magnification) * clip.w, clip.z, clip.w);
    }

    vec4 fisheyeClipSize(vec4 clip, out float magnification) {
        return vec4(fisheyeDisplay(clip.xy / clip.w, magnification) * clip.w, clip.z, clip.w);
    }
`;

// 精灵只平移 + 等比缩放，不逐角弯曲，避免月亮/光晕被拉成鸭蛋
const FISHEYE_SPRITE_CLIP_GLSL = /* glsl */ `
    vec4 fisheyeCenterView = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec4 fisheyeCenterClip = projectionMatrix * fisheyeCenterView;
    float fisheyeMagnification;
    vec2 fisheyeCenterNdc = fisheyeDisplay(
        fisheyeCenterClip.xy / fisheyeCenterClip.w,
        fisheyeMagnification
    );
    vec4 fisheyeOffsetClip = projectionMatrix
        * vec4(mvPosition.xyz - fisheyeCenterView.xyz, 0.0)
        * fisheyeMagnification;
    gl_Position = vec4(
        fisheyeCenterNdc * fisheyeCenterClip.w,
        fisheyeCenterClip.z,
        fisheyeCenterClip.w
    ) + fisheyeOffsetClip;
`;

function injectFisheyeShader(material, kind, weight = 1, uniforms = null) {
    const resolved = uniforms || createFisheyeUniforms(weight);
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uFisheyeStrength = resolved.uFisheyeStrength;
        shader.uniforms.uFisheyeAspect = resolved.uFisheyeAspect;
        shader.vertexShader = FISHEYE_VERTEX_GLSL + shader.vertexShader;
        if (shader.vertexShader.includes("gl_Position = projectionMatrix * mvPosition;")) {
            shader.vertexShader = shader.vertexShader.replace(
                "gl_Position = projectionMatrix * mvPosition;",
                kind === "sprite"
                    ? FISHEYE_SPRITE_CLIP_GLSL
                    : "gl_Position = fisheyeClip(projectionMatrix * mvPosition);"
            );
        } else {
            shader.vertexShader = shader.vertexShader.replace(
                "#include <project_vertex>",
                "#include <project_vertex>\ngl_Position = fisheyeClip(gl_Position);"
            );
        }
    };
    material.customProgramCacheKey = () => `fisheye-${kind}`;
    material.needsUpdate = true;
}

(function () {
    const sceneHost = document.getElementById("home-scene");
    const cardsGrid = document.getElementById("cards-grid");
    const cardsEmpty = document.getElementById("cards-empty");
    const secretEntry = document.getElementById("secret-entry");
    const secretEntryImage = document.getElementById("secret-entry-image");

    let disposeScene = null;
    let secretEntryDragged = false;

    // 1. 初始化页面元数据与卡片
    function initMetaAndCards() {
        if (SITE_CONFIG.meta?.title) {
            document.title = SITE_CONFIG.meta.title;
        }

        // 渲染卡片
        const cards = SITE_CONFIG.cards || [];
        if (cardsEmpty) {
            cardsEmpty.hidden = cards.length > 0;
        }

        if (cardsGrid) {
            cardsGrid.replaceChildren();
            cards.forEach((card) => {
                const link = document.createElement("a");
                link.className = "card-item";
                link.href = card.linkUrl || "#";
                link.target = card.target || "_self";
                if (card.target === "_blank") {
                    link.rel = "noopener noreferrer";
                }
                link.setAttribute("aria-label", card.title || "Card Link");

                const media = document.createElement("div");
                media.className = "card-media";

                const cover = document.createElement("img");
                cover.className = "card-cover";
                cover.src = card.imageUrl;
                cover.alt = card.title || "";
                cover.loading = "lazy";

                media.appendChild(cover);
                link.appendChild(media);
                cardsGrid.appendChild(link);
            });
        }
    }

    // 2. 初始化月亮上的神秘入口
    function initSecretEntry() {
        if (!secretEntry) return;

        const config = SITE_CONFIG.secretEntry || {};
        if (config.enabled === false) {
            secretEntry.hidden = true;
            return;
        }

        secretEntry.href = config.url || "#";
        secretEntry.target = config.target || "_blank";
        if (config.target === "_blank") {
            secretEntry.rel = "noopener noreferrer";
        }
        if (config.ariaLabel) {
            secretEntry.setAttribute("aria-label", config.ariaLabel);
        }

        if (secretEntryImage) {
            secretEntryImage.src = config.image || "./assets/images/secret-entry.gif";
            secretEntryImage.addEventListener("error", () => {
                const fallback = config.fallbackImage || "./assets/images/favicon.jpg";
                if (fallback && secretEntryImage.src !== fallback) {
                    secretEntryImage.src = fallback;
                }
            });
        }

        initSecretEntryDrag();
    }

    // 2.1 月亮上的图可以按住"揪出来"：拖动时生成跟随光标的幽灵图
    function initSecretEntryDrag() {
        if (!secretEntry || !secretEntryImage) return;

        secretEntry.draggable = false;
        secretEntryImage.draggable = false;
        secretEntry.addEventListener("dragstart", (event) => event.preventDefault());

        let drag = null;

        function createGhost() {
            const rect = secretEntry.getBoundingClientRect();
            const size = Math.round(Math.max(rect.width, rect.height) || 60);
            const ghost = document.createElement("img");
            ghost.className = "secret-entry-ghost";
            ghost.src = secretEntryImage.currentSrc || secretEntryImage.src;
            ghost.alt = "";
            ghost.draggable = false;
            ghost.setAttribute("aria-hidden", "true");
            ghost.style.width = `${size}px`;
            ghost.style.height = `${size}px`;
            return ghost;
        }

        function onDragMove(event) {
            if (!drag || event.pointerId !== drag.pointerId) return;

            if (!drag.moved) {
                const distance = Math.hypot(
                    event.clientX - drag.startX,
                    event.clientY - drag.startY,
                );
                if (distance < 4) return; // 轻微抖动不算拖拽，仍然是一次点击
                drag.moved = true;
                drag.ghost = createGhost();
                document.body.appendChild(drag.ghost);
                document.body.classList.add("secret-dragging");
            }

            drag.ghost.style.left = `${event.clientX}px`;
            drag.ghost.style.top = `${event.clientY}px`;
        }

        function onDragEnd(event) {
            if (!drag || (event && event.pointerId !== drag.pointerId)) return;

            window.removeEventListener("pointermove", onDragMove);
            window.removeEventListener("pointerup", onDragEnd);
            window.removeEventListener("pointercancel", onDragEnd);

            if (secretEntry.hasPointerCapture?.(drag.pointerId)) {
                secretEntry.releasePointerCapture(drag.pointerId);
            }
            drag.ghost?.remove();

            if (drag.moved) {
                // 拖完松手不能顺带触发跳转
                secretEntryDragged = true;
                window.setTimeout(() => {
                    secretEntryDragged = false;
                }, 0);
            }

            drag = null;
            document.body.classList.remove("secret-dragging");
        }

        secretEntry.addEventListener("pointerdown", (event) => {
            if (event.button !== 0 || event.pointerType === "touch") return;
            if (drag) onDragEnd(null);

            drag = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                moved: false,
                ghost: null,
            };
            secretEntry.setPointerCapture?.(event.pointerId);
            window.addEventListener("pointermove", onDragMove);
            window.addEventListener("pointerup", onDragEnd);
            window.addEventListener("pointercancel", onDragEnd);
        });

        secretEntry.addEventListener("click", (event) => {
            if (!secretEntryDragged) return;
            event.preventDefault();
            event.stopImmediatePropagation();
        });
    }

    // 3. 3D 夜空背景场景
    function ensureScene() {
        if (!sceneHost || disposeScene || sceneHost.querySelector("canvas")) {
            return;
        }
        disposeScene = createNightSky(sceneHost);
    }

    function createNightSky(host) {
        const isMobile = matchMedia("(max-width: 768px)").matches;
        const isMobileLike = !matchMedia("(pointer: fine)").matches;
        const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

        const scene = new THREE.Scene();

        // 关闭 MSAA、限制像素预算并以 60fps 渲染，兼顾流畅度与核显负载。
        const renderer = new THREE.WebGLRenderer({
            antialias: false,
            alpha: true,
            powerPreference: "high-performance",
            stencil: false,
        });
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.setClearColor(0x000000, 0);
        host.appendChild(renderer.domElement);

        const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 1400);
        camera.position.set(0, 0, 0);

        const skyGroup = new THREE.Group();
        const celestialGroup = new THREE.Group();
        const starGroup = new THREE.Group();
        const moonNearStarGroup = new THREE.Group();
        const nearStarGroup = new THREE.Group();
        const midStarGroup = new THREE.Group();
        const farStarGroup = new THREE.Group();
        const deepStarGroup = new THREE.Group();
        const deepBackdropGroup = new THREE.Group();
        const moonGroup = new THREE.Group();

        scene.add(skyGroup);
        scene.add(celestialGroup);
        scene.add(deepBackdropGroup);
        scene.add(moonGroup);
        celestialGroup.add(starGroup);
        starGroup.add(moonNearStarGroup);
        starGroup.add(nearStarGroup);
        starGroup.add(midStarGroup);
        starGroup.add(farStarGroup);
        starGroup.add(deepStarGroup);

        const target = { yaw: 0, pitch: 0 };
        const current = { yaw: 0, pitch: 0 };
        const autoState = { yaw: 0, pitch: 0 };
        const autoDriftSeed = Math.random() * Math.PI * 2;
        const gyroVelocity = { yaw: 0, pitch: 0 };
        const motion = reduceMotion ? { cleanup() {} } : createMotionController(gyroVelocity);

        // 天球自转：整片星空绕北天极作刚体旋转，星点沿弧线东升西落
        // 转轴抬高角 = 当地纬度，所以北极星稳居上方，越远的天区线速度越大
        const driftDegPerMinute = SITE_CONFIG.scene?.starRotationDegPerMinute ?? 12;
        const driftTiltDeg = SITE_CONFIG.scene?.starRotationTilt ?? 35;
        const driftSpeed = reduceMotion ? 0 : ((driftDegPerMinute * Math.PI) / 180) / 60;
        const driftTilt = (driftTiltDeg * Math.PI) / 180;
        const driftAxis = new THREE.Vector3(
            0,
            Math.sin(driftTilt),
            -Math.cos(driftTilt),
        ).normalize();
        let driftAngle = 0;

        const sky = createSkyDome();
        skyGroup.add(sky);

        const stars = createStarField(isMobile);
        const starLayers = Object.values(stars);
        moonNearStarGroup.add(stars.moonNear.points);
        nearStarGroup.add(stars.near.points);
        midStarGroup.add(stars.mid.points);
        farStarGroup.add(stars.far.points);
        deepStarGroup.add(stars.deep.points);

        // 极淡的银河尘带只负责提供深空结构，不做整屏雾化
        // 银河与星河属于深空背景，只跟随视差，不参与天球自转
        const galaxy = createGalaxyBand();
        deepBackdropGroup.add(galaxy.mesh);

        // 星之河用真正的点精灵绘制，保持颗粒清晰，而不是贴一层雾状纹理
        const starRiver = createStarRiver(isMobile);
        deepBackdropGroup.add(starRiver.points);
        starLayers.push(starRiver);

        const anchorStarGroup = new THREE.Group();
        starGroup.add(anchorStarGroup);
        const anchorStars = createAnchorStars(isMobile);
        anchorStarGroup.add(anchorStars.group);

        const moonTexturePath = SITE_CONFIG.scene?.moonTexture || "./assets/images/moon.png";
        const moon = createMoon(moonTexturePath);
        moonGroup.add(moon.halo);
        moonGroup.add(moon.aura);
        moonGroup.add(moon.glow);
        moonGroup.add(moon.occluder);
        moonGroup.add(moon.sprite);

        const meteor = createMeteorField();
        scene.add(meteor.group);

        const moonScreenPosition = new THREE.Vector3();
        const targetFrameMs = 1000 / 60;
        let rafId = 0;
        let disposed = false;
        let lastPaintAt = 0;
        let renderWidth = 1;
        let renderHeight = 1;
        let lastSecretX = Number.NaN;
        let lastSecretY = Number.NaN;
        let lastSecretSize = 0;

        function computePixelRatio(width, height) {
            const budget = Math.sqrt(
                (isMobile ? 2_200_000 : 3_300_000) / Math.max(width * height, 1)
            );
            return Math.max(
                0.8,
                Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 1.6, budget)
            );
        }

        function resize() {
            renderWidth = host.clientWidth || window.innerWidth || 1;
            renderHeight = host.clientHeight || window.innerHeight || 1;
            const pixelRatio = computePixelRatio(renderWidth, renderHeight);

            camera.aspect = renderWidth / Math.max(renderHeight, 1);
            camera.updateProjectionMatrix();
            renderer.setPixelRatio(pixelRatio);
            renderer.setSize(renderWidth, renderHeight, false);
            fisheyeAspectUniform.value = camera.aspect;
            moonFisheyeUniforms.uFisheyeStrength.value =
                FISHEYE_STRENGTH * moonFisheyeWeight(camera.aspect);

            for (const layer of starLayers) {
                layer.material.uniforms.uPixelRatio.value = pixelRatio;
            }
            anchorStars.layout(camera.aspect);

            positionMoon(moon, renderWidth, renderHeight);
            updateSecretEntryPosition(renderWidth, renderHeight);

            if (reduceMotion) {
                updateAndDraw(performance.now(), 0, true);
            }
        }

        function onPointerMove(event) {
            if (reduceMotion) return;
            const pointerX = (event.clientX / Math.max(window.innerWidth, 1)) * 2 - 1;
            const pointerY = (event.clientY / Math.max(window.innerHeight, 1)) * 2 - 1;
            target.yaw = pointerX * 0.088;
            target.pitch = pointerY * 0.08;
        }

        function onPointerLeave() {
            target.yaw = 0;
            target.pitch = 0;
        }

        function animate(now) {
            if (disposed) return;
            if (document.hidden) {
                rafId = 0;
                return;
            }

            rafId = window.requestAnimationFrame(animate);

            const elapsed = lastPaintAt ? now - lastPaintAt : Number.POSITIVE_INFINITY;
            if (elapsed < targetFrameMs - 1) return;

            // 切后台或掉帧后限制步长，避免星空/视差瞬移
            const delta = lastPaintAt ? Math.min(elapsed / 1000, 0.1) : 0;
            lastPaintAt = now;
            updateAndDraw(now, delta, false);
        }

        function updateAndDraw(now, delta, isStatic) {
            const time = isStatic ? 0 : now * 0.001;

            if (!isStatic && driftSpeed) {
                driftAngle += driftSpeed * delta;
                celestialGroup.quaternion.setFromAxisAngle(driftAxis, driftAngle);
            }

            if (!isStatic && isMobileLike) {
                const autoYaw = Math.sin(time * 0.2 + autoDriftSeed) * 0.048
                    + Math.sin(time * 0.21 + autoDriftSeed * 0.7) * 0.032;
                const autoPitch = Math.cos(time * 0.15 + autoDriftSeed) * 0.042
                    + Math.cos(time * 0.16 + autoDriftSeed * 0.5) * 0.025;

                autoState.yaw += (autoYaw - autoState.yaw) * (1 - Math.exp(-delta * 1.7));
                autoState.pitch += (autoPitch - autoState.pitch) * (1 - Math.exp(-delta * 1.9));

                const gyroDecay = Math.exp(-delta * 3.8);
                gyroVelocity.yaw *= gyroDecay;
                gyroVelocity.pitch *= gyroDecay;

                target.yaw = autoState.yaw + gyroVelocity.yaw;
                target.pitch = autoState.pitch + gyroVelocity.pitch;
            }

            if (!isStatic) {
                const follow = 1 - Math.exp(-delta * (isMobileLike ? 6.4 : 4.8));
                current.yaw += (target.yaw - current.yaw) * follow;
                current.pitch += (target.pitch - current.pitch) * follow;
            }

            const skyYaw = 0.34;
            const skyPitch = 0.42;
            // 从最近星层到星河按等差递增：每层视差 +0.2，避免近层贴在屏幕上
            const parallaxStep = 0.2;
            const moonNearYaw = 0.9;
            const moonNearPitch = 0.9;
            const nearYaw = moonNearYaw + parallaxStep;
            const nearPitch = moonNearPitch + parallaxStep;
            const midYaw = nearYaw + parallaxStep;
            const midPitch = nearPitch + parallaxStep;
            const farYaw = midYaw + parallaxStep;
            const farPitch = midPitch + parallaxStep;
            const deepYaw = farYaw + parallaxStep;
            const deepPitch = farPitch + parallaxStep;
            const backdropYaw = deepYaw + parallaxStep;
            const backdropPitch = deepPitch + parallaxStep;
            const moonYaw = 0.95;
            const moonPitch = 0.95;

            skyGroup.rotation.y = current.yaw * skyYaw;
            skyGroup.rotation.x = current.pitch * skyPitch;
            moonNearStarGroup.rotation.y = current.yaw * moonNearYaw;
            moonNearStarGroup.rotation.x = current.pitch * moonNearPitch;
            nearStarGroup.rotation.y = current.yaw * nearYaw;
            nearStarGroup.rotation.x = current.pitch * nearPitch;
            midStarGroup.rotation.y = current.yaw * midYaw;
            midStarGroup.rotation.x = current.pitch * midPitch;
            farStarGroup.rotation.y = current.yaw * farYaw;
            farStarGroup.rotation.x = current.pitch * farPitch;
            deepStarGroup.rotation.y = current.yaw * deepYaw;
            deepStarGroup.rotation.x = current.pitch * deepPitch;
            // 深空背景只保留最强视差，不跟随天球自转
            deepBackdropGroup.rotation.y = current.yaw * backdropYaw;
            deepBackdropGroup.rotation.x = current.pitch * backdropPitch;
            moonGroup.rotation.y = current.yaw * moonYaw;
            moonGroup.rotation.x = current.pitch * moonPitch;
            anchorStarGroup.rotation.y = current.yaw * nearYaw;
            anchorStarGroup.rotation.x = current.pitch * nearPitch;

            for (const layer of starLayers) {
                layer.material.uniforms.uTime.value = time;
            }
            anchorStars.update(time);

            if (!isStatic) {
                meteor.update(now);
            }

            // 极慢的呼吸光晕，让月亮与空间保持生命感而不产生高频闪烁
            moon.glow.material.opacity = isStatic ? 0.28 : 0.27 + Math.sin(time * 0.11) * 0.016;
            moon.halo.material.opacity = isStatic ? 0.14 : 0.135 + Math.sin(time * 0.06 + 1.9) * 0.012;
            moon.aura.material.opacity = isStatic ? 0.05 : 0.045 + Math.sin(time * 0.075 + 1.4) * 0.008;

            updateSecretEntryPosition(renderWidth, renderHeight);
            renderer.render(scene, camera);
        }

        // 与顶点着色器同一套畸变的逆解：把源画面 NDC 映射到畸变后的显示位置，
        // 让月亮的 DOM 入口始终贴在畸变后的月亮上
        function warpNdc(x, y, aspect, weight = 1) {
            const strength = FISHEYE_STRENGTH * weight;
            const sourceR = Math.hypot(x * aspect, y) / Math.hypot(aspect, 1);
            let displayR = sourceR;
            for (let i = 0; i < 3; i += 1) {
                const scale = 1 - strength * (1 - displayR * displayR);
                displayR = sourceR / Math.max(scale, 1e-3);
            }
            const factor = sourceR > 1e-6 ? displayR / sourceR : 1;
            return { x: x * factor, y: y * factor };
        }

        function updateSecretEntryPosition(width, height) {
            if (!secretEntry) return;

            moon.sprite.getWorldPosition(moonScreenPosition);
            moonScreenPosition.project(camera);
            const warped = warpNdc(
                moonScreenPosition.x,
                moonScreenPosition.y,
                width / Math.max(height, 1),
                moonFisheyeWeight(width / Math.max(height, 1)),
            );
            const x = (warped.x * 0.5 + 0.5) * width;
            const y = (-warped.y * 0.5 + 0.5) * height;
            const size = isMobileLike ? 58 : 70;

            if (
                Math.abs(x - lastSecretX) < 0.25
                && Math.abs(y - lastSecretY) < 0.25
                && size === lastSecretSize
            ) {
                return;
            }

            lastSecretX = x;
            lastSecretY = y;
            lastSecretSize = size;
            secretEntry.style.left = `${x.toFixed(2)}px`;
            secretEntry.style.top = `${y.toFixed(2)}px`;
            secretEntry.style.width = `${size}px`;
            secretEntry.style.height = `${size}px`;
        }

        function onVisibilityChange() {
            if (reduceMotion || disposed) return;
            if (document.hidden) {
                if (rafId) window.cancelAnimationFrame(rafId);
                rafId = 0;
            } else if (!rafId) {
                lastPaintAt = 0;
                rafId = window.requestAnimationFrame(animate);
            }
        }

        resize();
        window.addEventListener("resize", resize);
        document.addEventListener("visibilitychange", onVisibilityChange);

        if (!reduceMotion) {
            window.addEventListener("pointermove", onPointerMove);
            window.addEventListener("pointerleave", onPointerLeave);
            rafId = window.requestAnimationFrame(animate);
        }

        return function dispose() {
            disposed = true;
            if (rafId) window.cancelAnimationFrame(rafId);
            window.removeEventListener("resize", resize);
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerleave", onPointerLeave);
            document.removeEventListener("visibilitychange", onVisibilityChange);
            motion.cleanup();
            meteor.dispose();

            for (const layer of starLayers) {
                layer.geometry.dispose();
                layer.material.dispose();
            }
            anchorStars.dispose();
            galaxy.geometry.dispose();
            galaxy.material.dispose();
            galaxy.texture.dispose();

            moon.occluder.material.dispose();
            moon.sprite.material.map?.dispose();
            moon.sprite.material.dispose();
            moon.glow.material.map?.dispose();
            moon.glow.material.dispose();
            moon.halo.material.map?.dispose();
            moon.halo.material.dispose();
            moon.aura.material.dispose();

            sky.geometry.dispose();
            sky.material.dispose();
            renderer.dispose();
            renderer.forceContextLoss();
            host.replaceChildren();
        };
    }

    function createSkyDome() {
        const geometry = new THREE.SphereGeometry(520, 48, 32);
        const material = new THREE.ShaderMaterial({
            side: THREE.BackSide,
            depthWrite: false,
            depthTest: false,
            uniforms: {
                ...createFisheyeUniforms(),
                uZenithColor: { value: new THREE.Color(0x000102) },
                uUpperColor: { value: new THREE.Color(0x01040b) },
                uLowerColor: { value: new THREE.Color(0x040f1b) },
            },
            vertexShader: FISHEYE_VERTEX_GLSL + `
                varying vec3 vWorldPosition;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPosition.xyz;
                    gl_Position = fisheyeClip(projectionMatrix * modelViewMatrix * vec4(position, 1.0));
                }
            `,
            fragmentShader: `
                uniform vec3 uZenithColor;
                uniform vec3 uUpperColor;
                uniform vec3 uLowerColor;
                varying vec3 vWorldPosition;

                float hash21(vec2 p) {
                    p = fract(p * vec2(123.34, 456.21));
                    p += dot(p, p + 45.32);
                    return fract(p.x * p.y);
                }

                void main() {
                    float elevation = normalize(vWorldPosition).y;
                    vec3 sky = mix(uLowerColor, uUpperColor, smoothstep(-0.1, 0.42, elevation));
                    sky = mix(sky, uZenithColor, smoothstep(0.4, 0.98, elevation));

                    // 轻抖动打散大面积渐变的色带
                    float dither = (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
                    sky = max(sky + dither, vec3(0.0));

                    gl_FragColor = vec4(sky, 1.0);
                    #include <colorspace_fragment>
                }
            `,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.renderOrder = -100;
        return mesh;
    }

    function createStarField(isMobileViewport) {
        const isMobile = typeof isMobileViewport === "boolean"
            ? isMobileViewport
            : matchMedia("(max-width: 768px)").matches;
        const layerConfigs = isMobile
            ? [
                {
                    key: "moonNear",
                    count: 28,
                    radiusMin: 304,
                    radiusMax: 342,
                    scaleMin: 2.28,
                    scaleMax: 3.54,
                    alphaMin: 0.84,
                    alphaMax: 1.0,
                    depthMin: 1.34,
                    depthMax: 1.86,
                    yBias: 24,
                    yScale: 0.68,
                    brightChance: 0.5,
                    midChance: 0.94,
                    twinkleChance: 0.56,
                    twinkleMin: 0.46,
                    twinkleMax: 0.88,
                },
                {
                    key: "near",
                    count: 78,
                    radiusMin: 346,
                    radiusMax: 392,
                    scaleMin: 1.54,
                    scaleMax: 2.42,
                    alphaMin: 0.66,
                    alphaMax: 0.9,
                    depthMin: 1.12,
                    depthMax: 1.58,
                    yBias: 21,
                    yScale: 0.65,
                    brightChance: 0.36,
                    midChance: 0.88,
                    twinkleChance: 0.48,
                    twinkleMin: 0.42,
                    twinkleMax: 0.82,
                },
                {
                    key: "mid",
                    count: 226,
                    radiusMin: 402,
                    radiusMax: 458,
                    scaleMin: 0.92,
                    scaleMax: 1.58,
                    alphaMin: 0.34,
                    alphaMax: 0.56,
                    depthMin: 0.94,
                    depthMax: 1.34,
                    yBias: 18,
                    yScale: 0.62,
                    brightChance: 0.08,
                    midChance: 0.28,
                    twinkleChance: 0.34,
                    twinkleMin: 0.34,
                    twinkleMax: 0.7,
                },
                {
                    key: "far",
                    count: 316,
                    radiusMin: 466,
                    radiusMax: 522,
                    scaleMin: 0.5,
                    scaleMax: 0.9,
                    alphaMin: 0.15,
                    alphaMax: 0.28,
                    depthMin: 0.72,
                    depthMax: 1.0,
                    yBias: 14,
                    yScale: 0.58,
                    brightChance: 0.0,
                    midChance: 0.0,
                    twinkleChance: 0.24,
                    twinkleMin: 0.24,
                    twinkleMax: 0.52,
                },
                {
                    key: "deep",
                    count: 820,
                    radiusMin: 472,
                    radiusMax: 532,
                    scaleMin: 0.36,
                    scaleMax: 0.72,
                    alphaMin: 0.10,
                    alphaMax: 0.22,
                    depthMin: 0.55,
                    depthMax: 0.82,
                    yBias: 8,
                    yScale: 0.6,
                    brightChance: 0.0,
                    midChance: 0.18,
                    twinkleChance: 0.12,
                    twinkleMin: 0.1,
                    twinkleMax: 0.24,
                },
            ]
            : [
                {
                    key: "moonNear",
                    count: 58,
                    radiusMin: 308,
                    radiusMax: 348,
                    scaleMin: 2.32,
                    scaleMax: 3.68,
                    alphaMin: 0.84,
                    alphaMax: 1.0,
                    depthMin: 1.36,
                    depthMax: 1.9,
                    yBias: 24,
                    yScale: 0.68,
                    brightChance: 0.52,
                    midChance: 0.94,
                    twinkleChance: 0.54,
                    twinkleMin: 0.44,
                    twinkleMax: 0.88,
                },
                {
                    key: "near",
                    count: 154,
                    radiusMin: 344,
                    radiusMax: 394,
                    scaleMin: 1.56,
                    scaleMax: 2.46,
                    alphaMin: 0.66,
                    alphaMax: 0.92,
                    depthMin: 1.12,
                    depthMax: 1.6,
                    yBias: 21,
                    yScale: 0.65,
                    brightChance: 0.36,
                    midChance: 0.88,
                    twinkleChance: 0.48,
                    twinkleMin: 0.42,
                    twinkleMax: 0.84,
                },
                {
                    key: "mid",
                    count: 378,
                    radiusMin: 406,
                    radiusMax: 462,
                    scaleMin: 0.92,
                    scaleMax: 1.62,
                    alphaMin: 0.32,
                    alphaMax: 0.56,
                    depthMin: 0.96,
                    depthMax: 1.36,
                    yBias: 18,
                    yScale: 0.62,
                    brightChance: 0.08,
                    midChance: 0.28,
                    twinkleChance: 0.32,
                    twinkleMin: 0.32,
                    twinkleMax: 0.68,
                },
                {
                    key: "far",
                    count: 520,
                    radiusMin: 468,
                    radiusMax: 528,
                    scaleMin: 0.5,
                    scaleMax: 0.92,
                    alphaMin: 0.15,
                    alphaMax: 0.28,
                    depthMin: 0.72,
                    depthMax: 1.0,
                    yBias: 14,
                    yScale: 0.58,
                    brightChance: 0.0,
                    midChance: 0.0,
                    twinkleChance: 0.22,
                    twinkleMin: 0.22,
                    twinkleMax: 0.48,
                },
                {
                    key: "deep",
                    count: 1600,
                    radiusMin: 474,
                    radiusMax: 536,
                    scaleMin: 0.36,
                    scaleMax: 0.74,
                    alphaMin: 0.10,
                    alphaMax: 0.22,
                    depthMin: 0.55,
                    depthMax: 0.82,
                    yBias: 8,
                    yScale: 0.6,
                    brightChance: 0.0,
                    midChance: 0.16,
                    twinkleChance: 0.12,
                    twinkleMin: 0.1,
                    twinkleMax: 0.24,
                },
            ];

        const moonDirection = new THREE.Vector3(168, 120, -312).normalize();
        const moonMaskDot = Math.cos(0.018);

        const layers = {};
        for (const config of layerConfigs) {
            layers[config.key] = buildStarLayer(config, moonDirection, moonMaskDot);
        }
        return layers;
    }

    function buildStarLayer(config, moonDirection, moonMaskDot) {
        const positions = new Float32Array(config.count * 3);
        const colors = new Float32Array(config.count * 3);
        const scales = new Float32Array(config.count);
        const alphas = new Float32Array(config.count);
        const phases = new Float32Array(config.count);
        const twinkles = new Float32Array(config.count);
        const depths = new Float32Array(config.count);
        const sparkles = new Float32Array(config.count);
        const sparkleChance = config.key === "moonNear" ? 0.12 : config.key === "near" ? 0.06 : 0;

        for (let i = 0; i < config.count; i += 1) {
            const radius = config.radiusMin + Math.random() * (config.radiusMax - config.radiusMin);
            let x = 0;
            let y = 0;
            let z = 0;

            for (let attempt = 0; attempt < 12; attempt += 1) {
                const azimuth = Math.random() * Math.PI * 2;
                const elevation = Math.pow(Math.random(), 0.72) * Math.PI * 0.88;
                const sinPhi = Math.sin(elevation);
                x = radius * sinPhi * Math.cos(azimuth);
                z = -Math.abs(radius * Math.cos(elevation));
                y = radius * sinPhi * Math.sin(azimuth);
                const direction = new THREE.Vector3(x, y * config.yScale + config.yBias, z).normalize();
                if (direction.dot(moonDirection) < moonMaskDot) {
                    break;
                }
            }

            positions[i * 3] = x;
            positions[i * 3 + 1] = y * config.yScale + config.yBias;
            positions[i * 3 + 2] = z;
            depths[i] = config.depthMin + Math.random() * (config.depthMax - config.depthMin);

            const brightRoll = Math.random();
            if (brightRoll > config.midChance) {
                scales[i] = config.scaleMin + (config.scaleMax - config.scaleMin) * (0.74 + Math.random() * 0.26);
                alphas[i] = config.alphaMin + (config.alphaMax - config.alphaMin) * (0.76 + Math.random() * 0.24);
            } else if (brightRoll > config.brightChance) {
                scales[i] = config.scaleMin + (config.scaleMax - config.scaleMin) * (0.34 + Math.random() * 0.36);
                alphas[i] = config.alphaMin + (config.alphaMax - config.alphaMin) * (0.4 + Math.random() * 0.28);
            } else {
                scales[i] = config.scaleMin + Math.random() * (config.scaleMax - config.scaleMin) * 0.24;
                alphas[i] = config.alphaMin + Math.random() * (config.alphaMax - config.alphaMin) * 0.18;
            }

            const tint = STAR_TINTS[(Math.random() * STAR_TINTS.length) | 0];
            const tintGain = 0.94 + Math.random() * 0.06;
            colors[i * 3] = tint[0] * tintGain;
            colors[i * 3 + 1] = tint[1] * tintGain;
            colors[i * 3 + 2] = tint[2] * tintGain;

            phases[i] = Math.random() * Math.PI * 2;
            // 把闪烁降到 20~45 秒级，只留下几乎察觉不到的“呼吸”
            twinkles[i] = Math.random() > (1 - config.twinkleChance)
                ? (config.twinkleMin + Math.random() * (config.twinkleMax - config.twinkleMin)) * 0.45
                : 0.0;
            sparkles[i] = brightRoll > config.midChance && Math.random() < sparkleChance
                ? 0.55 + Math.random() * 0.45
                : 0.0;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute("aStarColor", new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute("aScale", new THREE.BufferAttribute(scales, 1));
        geometry.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
        geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute("aTwinkle", new THREE.BufferAttribute(twinkles, 1));
        geometry.setAttribute("aDepth", new THREE.BufferAttribute(depths, 1));
        geometry.setAttribute("aSparkle", new THREE.BufferAttribute(sparkles, 1));

        const material = new THREE.ShaderMaterial({
            transparent: true,
            depthTest: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: {
                ...createFisheyeUniforms(FISHEYE_LAYER_WEIGHTS[config.key] ?? 1),
                uTime: { value: 0 },
                uPixelRatio: { value: 1 },
            },
            vertexShader: FISHEYE_VERTEX_GLSL + `
                attribute float aScale;
                attribute float aAlpha;
                attribute float aPhase;
                attribute float aTwinkle;
                attribute float aDepth;
                attribute float aSparkle;
                attribute vec3 aStarColor;
                varying float vAlpha;
                varying float vPhase;
                varying float vTwinkle;
                varying float vSparkle;
                varying vec3 vColor;
                uniform float uPixelRatio;

                void main() {
                    vAlpha = aAlpha;
                    vPhase = aPhase;
                    vTwinkle = aTwinkle;
                    vSparkle = aSparkle;
                    vColor = aStarColor;

                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    float starSize = aScale * aDepth * (1.0 + aSparkle * 0.9);
                    float magnification;
                    gl_Position = fisheyeClipSize(projectionMatrix * mvPosition, magnification);
                    gl_PointSize = clamp(
                        starSize * uPixelRatio * (340.0 / max(1.0, -mvPosition.z)) * magnification,
                        0.9,
                        44.0
                    );
                }
            `,
            fragmentShader: `
                uniform float uTime;
                varying float vAlpha;
                varying float vPhase;
                varying float vTwinkle;
                varying float vSparkle;
                varying vec3 vColor;

                void main() {
                    vec2 centered = gl_PointCoord - vec2(0.5);
                    float dist = length(centered) * 2.0;
                    if (dist > 1.0) discard;

                    float core = 1.0 - smoothstep(0.03, 0.34, dist);
                    float halo = exp(-dist * dist * 7.4) * (0.24 + vSparkle * 0.12);

                    float ray = 0.0;
                    if (vSparkle > 0.0) {
                        vec2 axis = abs(centered);
                        float horizontal = exp(-axis.y * 30.0)
                            * (1.0 - smoothstep(0.04, 0.5, axis.x));
                        float vertical = exp(-axis.x * 30.0)
                            * (1.0 - smoothstep(0.04, 0.5, axis.y));
                        ray = (horizontal + vertical) * 0.24 * vSparkle;
                    }

                    float shimmer = vTwinkle > 0.0
                        ? sin(uTime * vTwinkle + vPhase) * 0.06
                        : 0.0;
                    float alpha = (core + halo + ray) * vAlpha * (1.0 + shimmer);
                    if (alpha < 0.006) discard;

                    gl_FragColor = vec4(vColor, min(alpha, 1.0));
                    #include <colorspace_fragment>
                }
            `,
        });

        const points = new THREE.Points(geometry, material);
        points.renderOrder = 10;
        return { geometry, material, points };
    }

    function createAnchorStars(isMobileViewport) {
        const definitions = isMobileViewport
            ? [
                { x: 0.18, y: 0.23, size: 21, color: 0xc4d8ff, opacity: 0.92 },
                { x: 0.52, y: 0.12, size: 15, color: 0xffe1b6, opacity: 0.76 },
                { x: 0.3, y: 0.43, size: 18, color: 0xeaf3ff, opacity: 0.8 },
                { x: 0.64, y: 0.55, size: 13, color: 0xd7def8, opacity: 0.62 },
            ]
            : [
                { x: 0.17, y: 0.24, size: 24, color: 0xc4d8ff, opacity: 0.92 },
                { x: 0.39, y: 0.12, size: 17, color: 0xffe1b6, opacity: 0.76 },
                { x: 0.28, y: 0.46, size: 20, color: 0xeaf3ff, opacity: 0.8 },
                { x: 0.56, y: 0.31, size: 14, color: 0xc7d5ff, opacity: 0.62 },
                { x: 0.85, y: 0.43, size: 22, color: 0xf7e6c9, opacity: 0.78 },
                { x: 0.66, y: 0.65, size: 13, color: 0xdbe6ff, opacity: 0.58 },
            ];

        const texture = buildAnchorStarTexture();
        const group = new THREE.Group();
        const sprites = [];

        for (let i = 0; i < definitions.length; i += 1) {
            const definition = definitions[i];
            const material = new THREE.SpriteMaterial({
                map: texture,
                transparent: true,
                depthTest: false,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                color: definition.color,
                opacity: definition.opacity,
                toneMapped: false,
            });
            injectFisheyeShader(material, "sprite");
            const sprite = new THREE.Sprite(material);
            sprite.scale.set(definition.size, definition.size, 1);
            sprite.renderOrder = 11;
            sprite.userData = {
                nx: definition.x,
                ny: definition.y,
                baseOpacity: definition.opacity,
                phase: Math.random() * Math.PI * 2,
                speed: 0.13 + Math.random() * 0.09,
            };
            group.add(sprite);
            sprites.push(sprite);
        }

        function layout(aspect) {
            const depth = 360;
            const halfHeight = Math.tan(THREE.MathUtils.degToRad(28)) * depth;
            const halfWidth = halfHeight * aspect;
            for (const sprite of sprites) {
                const { nx, ny } = sprite.userData;
                sprite.position.set(
                    (nx * 2 - 1) * halfWidth,
                    (1 - ny * 2) * halfHeight,
                    -depth
                );
            }
        }

        function update(time) {
            for (const sprite of sprites) {
                const { baseOpacity, phase, speed } = sprite.userData;
                sprite.material.opacity = baseOpacity
                    * (0.9 + Math.sin(time * speed + phase) * 0.1);
            }
        }

        layout((window.innerWidth || 1) / Math.max(window.innerHeight || 1, 1));

        return {
            group,
            layout,
            update,
            dispose() {
                for (const sprite of sprites) {
                    sprite.material.dispose();
                }
                texture.dispose();
            },
        };
    }

    function buildAnchorStarTexture() {
        const size = 256;
        const center = size / 2;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");

        const halo = ctx.createRadialGradient(center, center, 0, center, center, center);
        halo.addColorStop(0, "rgba(255, 255, 255, 1)");
        halo.addColorStop(0.022, "rgba(255, 255, 255, 0.94)");
        halo.addColorStop(0.075, "rgba(233, 243, 255, 0.42)");
        halo.addColorStop(0.19, "rgba(200, 222, 248, 0.14)");
        halo.addColorStop(0.46, "rgba(172, 201, 236, 0.04)");
        halo.addColorStop(1, "rgba(150, 186, 226, 0)");
        ctx.fillStyle = halo;
        ctx.fillRect(0, 0, size, size);

        ctx.globalCompositeOperation = "lighter";

        function drawRay(gradient, horizontalRay) {
            ctx.fillStyle = gradient;
            ctx.beginPath();
            if (horizontalRay) {
                ctx.moveTo(2, center);
                ctx.quadraticCurveTo(center * 0.76, center - 5.5, center, center - 7);
                ctx.quadraticCurveTo(center * 1.24, center - 5.5, size - 2, center);
                ctx.quadraticCurveTo(center * 1.24, center + 5.5, center, center + 7);
                ctx.quadraticCurveTo(center * 0.76, center + 5.5, 2, center);
            } else {
                ctx.moveTo(center, 2);
                ctx.quadraticCurveTo(center - 5.5, center * 0.76, center - 7, center);
                ctx.quadraticCurveTo(center - 5.5, center * 1.24, center, size - 2);
                ctx.quadraticCurveTo(center + 5.5, center * 1.24, center + 7, center);
                ctx.quadraticCurveTo(center + 5.5, center * 0.76, center, 2);
            }
            ctx.closePath();
            ctx.fill();
        }

        const horizontal = ctx.createLinearGradient(0, 0, size, 0);
        horizontal.addColorStop(0, "rgba(255, 255, 255, 0)");
        horizontal.addColorStop(0.32, "rgba(226, 240, 255, 0.02)");
        horizontal.addColorStop(0.43, "rgba(240, 248, 255, 0.2)");
        horizontal.addColorStop(0.48, "rgba(255, 255, 255, 0.72)");
        horizontal.addColorStop(0.5, "rgba(255, 255, 255, 1)");
        horizontal.addColorStop(0.52, "rgba(255, 255, 255, 0.72)");
        horizontal.addColorStop(0.57, "rgba(240, 248, 255, 0.2)");
        horizontal.addColorStop(0.68, "rgba(226, 240, 255, 0.02)");
        horizontal.addColorStop(1, "rgba(255, 255, 255, 0)");
        drawRay(horizontal, true);

        const vertical = ctx.createLinearGradient(0, 0, 0, size);
        vertical.addColorStop(0, "rgba(255, 255, 255, 0)");
        vertical.addColorStop(0.32, "rgba(226, 240, 255, 0.02)");
        vertical.addColorStop(0.43, "rgba(240, 248, 255, 0.2)");
        vertical.addColorStop(0.48, "rgba(255, 255, 255, 0.72)");
        vertical.addColorStop(0.5, "rgba(255, 255, 255, 1)");
        vertical.addColorStop(0.52, "rgba(255, 255, 255, 0.72)");
        vertical.addColorStop(0.57, "rgba(240, 248, 255, 0.2)");
        vertical.addColorStop(0.68, "rgba(226, 240, 255, 0.02)");
        vertical.addColorStop(1, "rgba(255, 255, 255, 0)");
        drawRay(vertical, false);

        ctx.globalCompositeOperation = "source-over";
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        return texture;
    }

    function createStarRiver(isMobileViewport) {
        const isMobile = typeof isMobileViewport === "boolean"
            ? isMobileViewport
            : matchMedia("(max-width: 768px)").matches;
        const count = isMobile ? 2400 : 4800;
        const aspect = (window.innerWidth || 1) / Math.max(window.innerHeight || 1, 1);
        const halfFov = Math.tan(THREE.MathUtils.degToRad(28));
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const scales = new Float32Array(count);
        const alphas = new Float32Array(count);
        const phases = new Float32Array(count);
        const twinkles = new Float32Array(count);
        const sparkles = new Float32Array(count);
        const tints = [
            [0.86, 0.93, 1.0],
            [0.64, 0.8, 1.0],
            [1.0, 0.95, 0.85],
            [0.92, 0.97, 1.0],
        ];

        function gaussian() {
            let u = 0;
            let v = 0;
            while (u === 0) u = Math.random();
            while (v === 0) v = Math.random();
            return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
        }

        for (let i = 0; i < count; i += 1) {
            const bulgeStar = Math.random() < 0.22;
            const along = THREE.MathUtils.clamp(
                bulgeStar ? 0.52 + gaussian() * 0.09 : Math.random(),
                0,
                1
            );
            const spine = Math.random() < 0.22;
            const core = Math.random() < 0.64;
            const sx = -0.5 + along * 2.0;
            const bulge = Math.exp(-Math.pow((sx - 0.5) / 0.18, 2));
            const widthScale = 0.5 + 0.9 * bulge;
            const sy = 0.3
                + sx * 0.39
                + Math.sin(sx * Math.PI * 1.6 + 0.7) * 0.025
                + gaussian() * (spine ? 0.0065 : core ? 0.022 : 0.058) * widthScale;
            const depth = 395 + Math.random() * 135;
            const halfHeight = halfFov * depth;
            const halfWidth = halfHeight * aspect;

            positions[i * 3] = (sx * 2 - 1) * halfWidth;
            positions[i * 3 + 1] = (1 - sy * 2) * halfHeight;
            positions[i * 3 + 2] = -depth;

            // 星河两端藏在视口之外，避免极限视差时看到断头
            const edge = THREE.MathUtils.smoothstep(sx, -0.45, -0.2)
                * (1 - THREE.MathUtils.smoothstep(sx, 1.2, 1.45));

            const roll = Math.random();
            let scale;
            let alpha;
            if (roll > 0.972) {
                scale = 2.4 + Math.random() * 1.2;
                alpha = 0.78 + Math.random() * 0.22;
                sparkles[i] = Math.random() < 0.1 ? 0.6 + Math.random() * 0.4 : 0;
            } else if (roll > 0.7) {
                scale = 1.3 + Math.random() * 0.8;
                alpha = 0.42 + Math.random() * 0.32;
            } else if (spine) {
                scale = 0.9 + Math.random() * 0.6;
                alpha = 0.26 + Math.random() * 0.36;
            } else {
                scale = 0.74 + Math.random() * 0.5;
                alpha = 0.15 + Math.random() * 0.23;
            }
            if (bulgeStar) {
                scale *= 1.1;
                alpha *= 1.18;
            }
            scales[i] = scale * (0.9 + 0.16 * bulge);
            alphas[i] = alpha * edge * (0.7 + 0.55 * bulge);

            const tintRoll = Math.random();
            const tint = tintRoll < 0.12
                ? tints[2]
                : tintRoll < 0.38
                    ? tints[1]
                    : tints[Math.random() < 0.5 ? 0 : 3];
            colors[i * 3] = tint[0];
            colors[i * 3 + 1] = tint[1];
            colors[i * 3 + 2] = tint[2];
            phases[i] = Math.random() * Math.PI * 2;
            twinkles[i] = Math.random() < 0.42
                ? 0.055 + Math.random() * 0.13
                : 0;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute("aStarColor", new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute("aScale", new THREE.BufferAttribute(scales, 1));
        geometry.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
        geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute("aTwinkle", new THREE.BufferAttribute(twinkles, 1));
        geometry.setAttribute("aSparkle", new THREE.BufferAttribute(sparkles, 1));

        const material = new THREE.ShaderMaterial({
            transparent: true,
            depthTest: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: {
                ...createFisheyeUniforms(FISHEYE_LAYER_WEIGHTS.deep),
                uTime: { value: 0 },
                uPixelRatio: { value: 1 },
            },
            vertexShader: FISHEYE_VERTEX_GLSL + `
                attribute vec3 aStarColor;
                attribute float aScale;
                attribute float aAlpha;
                attribute float aPhase;
                attribute float aTwinkle;
                attribute float aSparkle;
                varying vec3 vColor;
                varying float vAlpha;
                varying float vPhase;
                varying float vTwinkle;
                varying float vSparkle;
                uniform float uPixelRatio;

                void main() {
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    float magnification;
                    gl_Position = fisheyeClipSize(projectionMatrix * mvPosition, magnification);
                    gl_PointSize = clamp(
                        aScale * uPixelRatio * (560.0 / max(1.0, -mvPosition.z)) * magnification,
                        1.1,
                        11.0
                    );
                    vColor = aStarColor;
                    vAlpha = aAlpha;
                    vPhase = aPhase;
                    vTwinkle = aTwinkle;
                    vSparkle = aSparkle;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                varying vec3 vColor;
                varying float vAlpha;
                varying float vPhase;
                varying float vTwinkle;
                varying float vSparkle;

                void main() {
                    vec2 centered = gl_PointCoord - vec2(0.5);
                    float dist = length(centered) * 2.0;
                    if (dist > 1.0) discard;

                    float core = 1.0 - smoothstep(0.2, 0.36, dist);
                    float halo = exp(-dist * dist * 8.5) * 0.16;
                    float ray = 0.0;
                    if (vSparkle > 0.0) {
                        vec2 axis = abs(centered);
                        float horizontal = exp(-axis.y * 34.0)
                            * (1.0 - smoothstep(0.05, 0.5, axis.x));
                        float vertical = exp(-axis.x * 34.0)
                            * (1.0 - smoothstep(0.05, 0.5, axis.y));
                        ray = (horizontal + vertical) * 0.2 * vSparkle;
                    }

                    float shimmer = vTwinkle > 0.0
                        ? sin(uTime * vTwinkle + vPhase) * 0.07
                        : 0.0;
                    float alpha = (core + halo + ray) * vAlpha * (1.0 + shimmer);
                    if (alpha < 0.004) discard;

                    gl_FragColor = vec4(vColor, min(alpha, 1.0));
                    #include <colorspace_fragment>
                }
            `,
        });

        const points = new THREE.Points(geometry, material);
        points.renderOrder = 9;
        return { geometry, material, points };
    }

    function createGalaxyBand() {
        const texture = buildGalaxyTexture();
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.needsUpdate = true;

        const geometry = new THREE.PlaneGeometry(3000, 1200, 60, 24);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            opacity: 1.0,
            color: 0xd8e7ff,
            toneMapped: false,
        });
        injectFisheyeShader(material, "mesh", FISHEYE_LAYER_WEIGHTS.far);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(0, 0, -520);
        mesh.rotation.z = -0.175;
        mesh.frustumCulled = false;
        mesh.renderOrder = -30;
        return { mesh, geometry, material, texture };
    }

    function buildGalaxyTexture() {
        const width = 1536;
        const height = 768;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        const TAU = Math.PI * 2;

        function gaussian() {
            let u = 0;
            let v = 0;
            while (u === 0) u = Math.random();
            while (v === 0) v = Math.random();
            return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
        }

        function bandCurve(x) {
            const t = x / width;
            return height * 0.49
                + Math.sin(t * Math.PI * 1.35 + 0.8) * height * 0.045
                + Math.sin(t * Math.PI * 3.6 + 1.3) * height * 0.009;
        }

        function smoothstep(value, edge0, edge1) {
            const x = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
            return x * x * (3 - 2 * x);
        }

        // 银河的轮廓：中央银心隆起、两端收束成薄雾，避免整条河带头尾等宽
        function bandProfile(t) {
            const x = Math.min(Math.max(t, 0), 1);
            const ends = smoothstep(x, 0.03, 0.2) * (1 - smoothstep(x, 0.8, 0.97));
            const bulge = Math.exp(-Math.pow((x - 0.5) / 0.12, 2));
            return {
                width: ends * (0.28 + 1.15 * bulge),
                alpha: ends * (0.4 + 0.95 * bulge),
            };
        }

        function rgba(color, alpha) {
            return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
        }

        function paintCloud(x, y, rx, ry, rotation, color, alpha) {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(rotation);
            ctx.scale(rx, ry);
            const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
            gradient.addColorStop(0, rgba(color, alpha));
            gradient.addColorStop(0.34, rgba(color, alpha * 0.5));
            gradient.addColorStop(0.7, rgba(color, alpha * 0.13));
            gradient.addColorStop(1, rgba(color, 0));
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(0, 0, 1, 0, TAU);
            ctx.fill();
            ctx.restore();
        }

        const cool = [
            [58, 96, 154],
            [70, 118, 178],
            [86, 140, 198],
        ];
        const pale = [
            [166, 194, 232],
            [204, 224, 248],
            [234, 243, 255],
        ];
        const warm = [255, 233, 206];

        ctx.clearRect(0, 0, width, height);
        ctx.globalCompositeOperation = "lighter";

        // 贴着河带的极淡底晕，只给银河一点厚度，不向整屏铺开
        for (let i = 0; i < 34; i += 1) {
            const x = -width * 0.04 + Math.random() * width * 1.08;
            const profile = bandProfile(x / width);
            const y = bandCurve(x) + gaussian() * height * 0.035 * profile.width;
            paintCloud(
                x,
                y,
                width * (0.04 + Math.random() * 0.07),
                height * (0.01 + Math.random() * 0.02) * profile.width,
                (Math.random() - 0.5) * 0.7,
                cool[(Math.random() * cool.length) | 0],
                (0.008 + Math.random() * 0.01) * profile.alpha
            );
        }

        // 银河主体：窄而断续的银色尘带
        for (let i = 0; i < 190; i += 1) {
            const x = width * (0.02 + Math.random() * 0.96);
            const profile = bandProfile(x / width);
            const y = bandCurve(x) + gaussian() * height * 0.018 * profile.width;
            paintCloud(
                x,
                y,
                width * (0.01 + Math.random() * 0.03),
                height * (0.0035 + Math.random() * 0.008) * profile.width,
                (Math.random() - 0.5) * 0.7,
                cool[(Math.random() * cool.length) | 0],
                (0.04 + Math.random() * 0.04) * profile.alpha
            );
        }

        // 沿河带铺一层很淡的月白辉光，先让银河有“体积”
        for (let i = 0; i < 20; i += 1) {
            const x = width * (0.04 + Math.random() * 0.92);
            const profile = bandProfile(x / width);
            const y = bandCurve(x) + gaussian() * height * 0.024 * profile.width;
            paintCloud(
                x,
                y,
                width * (0.08 + Math.random() * 0.11),
                height * (0.018 + Math.random() * 0.022) * profile.width,
                (Math.random() - 0.5) * 0.3,
                pale[(Math.random() * pale.length) | 0],
                (0.008 + Math.random() * 0.008) * profile.alpha
            );
        }

        // 银心：一团柔和的星辰密集区，作为深空里的视觉重心
        for (let i = 0; i < 22; i += 1) {
            const x = width * (0.44 + Math.random() * 0.16);
            const profile = bandProfile(x / width);
            const y = bandCurve(x) + gaussian() * height * 0.009 * profile.width;
            paintCloud(
                x,
                y,
                width * (0.008 + Math.random() * 0.02),
                height * (0.0015 + Math.random() * 0.0034) * profile.width,
                (Math.random() - 0.5) * 0.25,
                Math.random() < 0.3 ? warm : pale[(Math.random() * pale.length) | 0],
                (0.045 + Math.random() * 0.05) * profile.alpha
            );
        }
        for (let i = 0; i < 6; i += 1) {
            const x = width * (0.4 + Math.random() * 0.2);
            const profile = bandProfile(x / width);
            const y = bandCurve(x) + gaussian() * height * 0.015 * profile.width;
            paintCloud(
                x,
                y,
                width * (0.03 + Math.random() * 0.035),
                height * (0.01 + Math.random() * 0.012) * profile.width,
                (Math.random() - 0.5) * 0.2,
                [206, 224, 246],
                (0.005 + Math.random() * 0.005) * profile.alpha
            );
        }

        // 更亮的核心与团块，集中在河带中段
        for (let i = 0; i < 72; i += 1) {
            const t = 0.18 + Math.random() * 0.64;
            const x = width * t;
            const profile = bandProfile(t);
            const y = bandCurve(x) + gaussian() * height * 0.006 * profile.width;
            paintCloud(
                x,
                y,
                width * (0.006 + Math.random() * 0.015),
                height * (0.0012 + Math.random() * 0.0026) * profile.width,
                (Math.random() - 0.5) * 0.22,
                Math.random() < 0.14 ? warm : pale[(Math.random() * pale.length) | 0],
                (0.07 + Math.random() * 0.06) * profile.alpha
            );
        }

        // 银心附近的一团柔光，让河带有明暗重心
        for (let i = 0; i < 7; i += 1) {
            const x = width * (0.34 + Math.random() * 0.34);
            const profile = bandProfile(x / width);
            const y = bandCurve(x) + gaussian() * height * 0.014 * profile.width;
            paintCloud(
                x,
                y,
                width * (0.055 + Math.random() * 0.07),
                height * (0.012 + Math.random() * 0.014) * profile.width,
                (Math.random() - 0.5) * 0.25,
                pale[(Math.random() * pale.length) | 0],
                (0.006 + Math.random() * 0.006) * profile.alpha
            );
        }

        // 银心的大尺度朦胧光晕，把中央鼓起一块，而不是等宽的带子
        for (let i = 0; i < 8; i += 1) {
            const t = 0.44 + Math.random() * 0.12;
            const x = width * t;
            const profile = bandProfile(t);
            const y = bandCurve(x) + gaussian() * height * 0.02 * profile.width;
            paintCloud(
                x,
                y,
                width * (0.07 + Math.random() * 0.07),
                height * (0.02 + Math.random() * 0.022) * profile.width,
                (Math.random() - 0.5) * 0.2,
                Math.random() < 0.35 ? warm : pale[(Math.random() * pale.length) | 0],
                (0.009 + Math.random() * 0.009) * profile.alpha
            );
        }

        // 几处冷色星云薄纱，给银河一点空灵的颜色层次
        const accent = [
            [88, 132, 198],
            [112, 158, 210],
            [80, 146, 168],
            [112, 124, 190],
        ];
        for (let i = 0; i < 7; i += 1) {
            const t = 0.12 + Math.random() * 0.76;
            const x = width * t;
            const profile = bandProfile(t);
            const y = bandCurve(x) + gaussian() * height * 0.012 * profile.width;
            paintCloud(
                x,
                y,
                width * (0.03 + Math.random() * 0.045),
                height * (0.007 + Math.random() * 0.012) * profile.width,
                (Math.random() - 0.5) * 0.3,
                accent[(Math.random() * accent.length) | 0],
                (0.004 + Math.random() * 0.006) * profile.alpha
            );
        }

        // 暗尘裂缝：在河带里擦出几道空隙，增强纵深
        ctx.globalCompositeOperation = "destination-out";
        for (let i = 0; i < 22; i += 1) {
            const x = width * (0.08 + Math.random() * 0.84);
            const profile = bandProfile(x / width);
            const y = bandCurve(x) + (Math.random() - 0.5) * height * 0.02 * profile.width;
            paintCloud(
                x,
                y,
                width * (0.025 + Math.random() * 0.055),
                height * (0.0018 + Math.random() * 0.0042) * profile.width,
                (Math.random() - 0.5) * 0.7,
                [0, 0, 0],
                (0.32 + Math.random() * 0.26) * Math.min(profile.alpha, 1.05)
            );
        }

        // 细碎星尘，保持颗粒感
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < 1800; i += 1) {
            const x = -width * 0.05 + Math.random() * width * 1.1;
            const profile = bandProfile(x / width);
            const y = bandCurve(x) + gaussian() * height * 0.036 * profile.width;
            const r = Math.random() < 0.012
                ? 0.5 + Math.random() * 0.55
                : 0.14 + Math.random() * 0.34;
            const alpha = (0.03 + Math.pow(Math.random(), 2.0) * 0.3) * profile.alpha;
            const color = Math.random() < 0.05 ? [255, 236, 210] : [208, 226, 246];
            ctx.fillStyle = rgba(color, alpha);
            ctx.beginPath();
            ctx.arc(x, y, r, 0, TAU);
            ctx.fill();
        }

        // 几处星团，让河带的细节更接近真实深空照片
        for (let c = 0; c < 10; c += 1) {
            const cx = width * (0.08 + Math.random() * 0.84);
            const profile = bandProfile(cx / width);
            const cy = bandCurve(cx) + gaussian() * height * 0.012 * profile.width;
            const spreadX = width * (0.006 + Math.random() * 0.012);
            const spreadY = height * (0.004 + Math.random() * 0.007) * profile.width;
            for (let i = 0; i < 34; i += 1) {
                const x = cx + gaussian() * spreadX;
                const y = cy + gaussian() * spreadY;
                const r = 0.15 + Math.random() * 0.5;
                const alpha = (0.06 + Math.pow(Math.random(), 1.6) * 0.24) * profile.alpha;
                const color = Math.random() < 0.08 ? [255, 236, 210] : [212, 230, 250];
                ctx.fillStyle = rgba(color, alpha);
                ctx.beginPath();
                ctx.arc(x, y, r, 0, TAU);
                ctx.fill();
            }
        }

        // 四边柔和淡出，避免出现纹理边界
        ctx.globalCompositeOperation = "destination-in";
        const fadeX = ctx.createLinearGradient(0, 0, width, 0);
        fadeX.addColorStop(0, "rgba(255, 255, 255, 0)");
        fadeX.addColorStop(0.01, "rgba(255, 255, 255, 1)");
        fadeX.addColorStop(0.99, "rgba(255, 255, 255, 1)");
        fadeX.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.fillStyle = fadeX;
        ctx.fillRect(0, 0, width, height);

        const fadeY = ctx.createLinearGradient(0, 0, 0, height);
        fadeY.addColorStop(0, "rgba(255, 255, 255, 0)");
        fadeY.addColorStop(0.08, "rgba(255, 255, 255, 1)");
        fadeY.addColorStop(0.92, "rgba(255, 255, 255, 1)");
        fadeY.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.fillStyle = fadeY;
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = "source-over";

        // 银河退远：叠加一层大半径的朦胧光晕，再整体轻微柔化。
        // 去掉星屑和尘埃裂缝的锐利边缘，避免它看起来像贴在眼前的近景层。
        const softCanvas = document.createElement("canvas");
        softCanvas.width = width;
        softCanvas.height = height;
        const softCtx = softCanvas.getContext("2d");
        if (typeof softCtx.filter === "string") {
            softCtx.filter = "blur(18px)";
            softCtx.globalAlpha = 0.42;
            softCtx.drawImage(canvas, 0, 0);
            softCtx.filter = "blur(3.5px)";
            softCtx.globalAlpha = 1;
            softCtx.drawImage(canvas, 0, 0);
        } else {
            softCtx.drawImage(canvas, 0, 0);
        }

        return new THREE.CanvasTexture(softCanvas);
    }

    function createMeteorField() {
        const tailCount = 22;
        const positions = new Float32Array(tailCount * 3);
        const colors = new Float32Array(tailCount * 3);
        for (let i = 0; i < tailCount; i += 1) {
            const fade = Math.pow(1 - i / (tailCount - 1), 2.3);
            colors[i * 3] = 0.74 * fade;
            colors[i * 3 + 1] = 0.86 * fade;
            colors[i * 3 + 2] = 1.0 * fade;
        }

        const geometry = new THREE.BufferGeometry();
        const positionAttribute = new THREE.BufferAttribute(positions, 3);
        positionAttribute.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute("position", positionAttribute);
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

        const lineMaterial = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
        });
        injectFisheyeShader(lineMaterial, "line");
        const line = new THREE.Line(geometry, lineMaterial);
        line.frustumCulled = false;
        line.visible = false;
        line.renderOrder = 12;

        const headTexture = buildGlowTexture();
        const headMaterial = new THREE.SpriteMaterial({
            map: headTexture,
            color: 0xdceeff,
            transparent: true,
            opacity: 0,
            depthTest: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
        });
        injectFisheyeShader(headMaterial, "sprite");
        const head = new THREE.Sprite(headMaterial);
        head.scale.set(8, 8, 1);
        head.visible = false;
        head.renderOrder = 13;

        const group = new THREE.Group();
        group.add(line);
        group.add(head);

        const state = {
            active: false,
            startedAt: 0,
            nextAt: performance.now() + 6500 + Math.random() * 7500,
            duration: 1,
            travel: 0,
            tail: 0,
            start: new THREE.Vector3(),
            direction: new THREE.Vector3(),
        };

        function start(now) {
            const z = -300;
            const aspect = (window.innerWidth || 1) / Math.max(window.innerHeight || 1, 1);
            const halfHeight = Math.tan(THREE.MathUtils.degToRad(28)) * -z;
            const halfWidth = halfHeight * aspect;
            const fromLeft = Math.random() < 0.55;
            const startX = fromLeft
                ? -halfWidth * (0.88 + Math.random() * 0.16)
                : halfWidth * (0.46 + Math.random() * 0.32);
            const startY = halfHeight * (0.34 + Math.random() * 0.46);
            const dx = (fromLeft ? 1 : -1) * halfWidth * (0.56 + Math.random() * 0.36);
            const dy = -halfHeight * (0.3 + Math.random() * 0.42);

            state.start.set(startX, startY, z);
            state.direction.set(dx, dy, 0);
            state.travel = Math.hypot(dx, dy);
            state.tail = state.travel * (0.16 + Math.random() * 0.12);
            state.duration = 0.85 + Math.random() * 0.45;
            state.startedAt = now;
            state.active = true;
            line.visible = true;
            head.visible = true;
        }

        function update(now) {
            if (!state.active) {
                if (now < state.nextAt) return;
                start(now);
            }

            const progress = (now - state.startedAt) / (state.duration * 1000);
            if (progress >= 1) {
                state.active = false;
                state.nextAt = now + 18000 + Math.random() * 20000;
                line.visible = false;
                head.visible = false;
                lineMaterial.opacity = 0;
                headMaterial.opacity = 0;
                return;
            }

            const dx = state.direction.x / state.travel;
            const dy = state.direction.y / state.travel;
            const headX = state.start.x + state.direction.x * progress;
            const headY = state.start.y + state.direction.y * progress;

            for (let i = 0; i < tailCount; i += 1) {
                const step = (i / (tailCount - 1)) * state.tail;
                positions[i * 3] = headX - dx * step;
                positions[i * 3 + 1] = headY - dy * step;
                positions[i * 3 + 2] = state.start.z;
            }
            positionAttribute.needsUpdate = true;

            const fadeIn = Math.min(1, progress / 0.13);
            const fadeOut = Math.min(1, (1 - progress) / 0.34);
            const envelope = Math.max(0, Math.min(fadeIn, fadeOut));
            lineMaterial.opacity = envelope * 0.55;
            headMaterial.opacity = envelope * 0.4;
            head.position.set(headX, headY, state.start.z + 1);
        }

        return {
            group,
            update,
            dispose() {
                geometry.dispose();
                lineMaterial.dispose();
                headTexture.dispose();
                headMaterial.dispose();
            },
        };
    }

    function createMoon(moonTextureUrl) {
        const moonTexture = new THREE.TextureLoader().load(moonTextureUrl);
        moonTexture.colorSpace = THREE.SRGBColorSpace;

        const occluderMaterial = new THREE.SpriteMaterial({
            transparent: false,
            depthWrite: true,
            depthTest: false,
            opacity: 1,
            color: 0xffffff,
        });
        occluderMaterial.colorWrite = false;
        injectFisheyeShader(occluderMaterial, "sprite", 1, moonFisheyeUniforms);
        const occluderSprite = new THREE.Sprite(occluderMaterial);
        occluderSprite.position.set(168, 120, -312);
        occluderSprite.scale.set(60, 60, 1);
        occluderSprite.renderOrder = 9;

        const moonMaterial = new THREE.SpriteMaterial({
            map: moonTexture,
            transparent: true,
            depthWrite: false,
            depthTest: false,
            opacity: 0.96,
            color: 0xf2f5f7,
        });
        injectFisheyeShader(moonMaterial, "sprite", 1, moonFisheyeUniforms);
        const moonSprite = new THREE.Sprite(moonMaterial);
        moonSprite.position.set(168, 120, -312);
        moonSprite.scale.set(58, 58, 1);
        moonSprite.renderOrder = 30;

        const glowTexture = buildGlowTexture();
        const glowMaterial = new THREE.SpriteMaterial({
            map: glowTexture,
            transparent: true,
            depthWrite: false,
            depthTest: false,
            blending: THREE.AdditiveBlending,
            opacity: 0.33,
            color: 0xdde9f7,
            toneMapped: false,
        });
        injectFisheyeShader(glowMaterial, "sprite", 1, moonFisheyeUniforms);
        const glowSprite = new THREE.Sprite(glowMaterial);
        glowSprite.position.copy(moonSprite.position);
        glowSprite.scale.set(132, 132, 1);
        glowSprite.renderOrder = 29;

        const haloTexture = buildMoonHaloTexture();
        const haloMaterial = new THREE.SpriteMaterial({
            map: haloTexture,
            transparent: true,
            depthWrite: false,
            depthTest: false,
            blending: THREE.AdditiveBlending,
            opacity: 0.15,
            color: 0xbcd4ef,
            toneMapped: false,
        });
        injectFisheyeShader(haloMaterial, "sprite", 1, moonFisheyeUniforms);
        const haloSprite = new THREE.Sprite(haloMaterial);
        haloSprite.position.copy(moonSprite.position);
        haloSprite.scale.set(276, 276, 1);
        haloSprite.renderOrder = 27;

        const auraMaterial = new THREE.SpriteMaterial({
            map: glowTexture,
            transparent: true,
            depthWrite: false,
            depthTest: false,
            blending: THREE.AdditiveBlending,
            opacity: 0.06,
            color: 0x86abc9,
            toneMapped: false,
        });
        injectFisheyeShader(auraMaterial, "sprite", 1, moonFisheyeUniforms);
        const auraSprite = new THREE.Sprite(auraMaterial);
        auraSprite.position.copy(moonSprite.position);
        auraSprite.scale.set(190, 190, 1);
        auraSprite.renderOrder = 28;

        return {
            occluder: occluderSprite,
            sprite: moonSprite,
            glow: glowSprite,
            halo: haloSprite,
            aura: auraSprite,
        };
    }

    function positionMoon(moon, width, height) {
        const aspect = width / Math.max(height, 1);
        const narrowness = THREE.MathUtils.clamp((1.82 - aspect) / 1.08, 0, 1);
        const moonX = THREE.MathUtils.lerp(160, 38, narrowness);
        const moonY = THREE.MathUtils.lerp(116, 86, narrowness);
        const moonScale = THREE.MathUtils.lerp(58, 46, narrowness);
        const glowScale = THREE.MathUtils.lerp(132, 106, narrowness);
        const haloScale = THREE.MathUtils.lerp(276, 224, narrowness);
        const auraScale = THREE.MathUtils.lerp(215, 172, narrowness);
        const occluderScale = moonScale * 1.08;

        moon.occluder.position.set(moonX, moonY, -312);
        moon.occluder.scale.set(occluderScale, occluderScale, 1);
        moon.sprite.position.set(moonX, moonY, -312);
        moon.glow.position.copy(moon.sprite.position);
        moon.halo.position.copy(moon.sprite.position);
        moon.aura.position.copy(moon.sprite.position);
        moon.sprite.scale.set(moonScale, moonScale, 1);
        moon.glow.scale.set(glowScale, glowScale, 1);
        moon.halo.scale.set(haloScale, haloScale, 1);
        moon.aura.scale.set(auraScale, auraScale, 1);
    }

    function createMotionController(gyroVelocity) {
        const controller = { active: false, lastEventAt: 0, cleanup() {} };
        if (!SITE_CONFIG.scene?.enableGyroscope) {
            return controller;
        }

        let lastSampleYaw = null;
        let lastSamplePitch = null;

        if (matchMedia("(pointer:fine)").matches || typeof window.DeviceOrientationEvent === "undefined") {
            return controller;
        }

        const onOrientation = (event) => {
            if (typeof event.gamma !== "number" || typeof event.beta !== "number") {
                return;
            }
            controller.active = true;
            controller.lastEventAt = performance.now();
            const sampleYaw = THREE.MathUtils.clamp(event.gamma / 32, -1, 1);
            const samplePitch = THREE.MathUtils.clamp((event.beta - 45) / 40, -1, 1);

            if (lastSampleYaw !== null && lastSamplePitch !== null) {
                let deltaYaw = sampleYaw - lastSampleYaw;
                let deltaPitch = samplePitch - lastSamplePitch;

                if (Math.abs(deltaYaw) < 0.014) deltaYaw = 0;
                if (Math.abs(deltaPitch) < 0.014) deltaPitch = 0;

                gyroVelocity.yaw = accumulateGyroVelocity(gyroVelocity.yaw, deltaYaw * 0.9, 0.12);
                gyroVelocity.pitch = accumulateGyroVelocity(gyroVelocity.pitch, deltaPitch * 0.78, 0.1);
            }

            lastSampleYaw = sampleYaw;
            lastSamplePitch = samplePitch;
        };

        const bindOrientation = () => {
            window.addEventListener("deviceorientation", onOrientation);
        };

        const requestPermission = async () => {
            try {
                if (typeof window.DeviceOrientationEvent?.requestPermission === "function") {
                    const result = await window.DeviceOrientationEvent.requestPermission();
                    if (result === "granted") {
                        bindOrientation();
                    }
                } else {
                    bindOrientation();
                }
            } catch (_error) {
                // ignore
            }
            window.removeEventListener("touchstart", requestPermission);
            window.removeEventListener("pointerdown", requestPermission);
        };

        if (typeof window.DeviceOrientationEvent?.requestPermission === "function") {
            window.addEventListener("touchstart", requestPermission, { once: true });
            window.addEventListener("pointerdown", requestPermission, { once: true });
        } else {
            requestPermission();
        }

        controller.cleanup = () => {
            window.removeEventListener("deviceorientation", onOrientation);
            window.removeEventListener("touchstart", requestPermission);
            window.removeEventListener("pointerdown", requestPermission);
        };

        return controller;
    }

    function accumulateGyroVelocity(current, delta, limit) {
        if (!delta) return current;
        const ratio = Math.min(Math.abs(current) / limit, 1);
        const headroom = THREE.MathUtils.lerp(1, 0.18, ratio * ratio);
        const next = current + delta * headroom;
        return THREE.MathUtils.clamp(next, -limit, limit);
    }

    function buildMoonHaloTexture() {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const context = canvas.getContext("2d");
        const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
        gradient.addColorStop(0, "rgba(212, 231, 252, 0.30)");
        gradient.addColorStop(0.16, "rgba(208, 228, 250, 0.25)");
        gradient.addColorStop(0.32, "rgba(198, 221, 247, 0.15)");
        gradient.addColorStop(0.52, "rgba(184, 210, 242, 0.065)");
        gradient.addColorStop(0.72, "rgba(172, 200, 236, 0.022)");
        gradient.addColorStop(0.88, "rgba(164, 194, 232, 0.006)");
        gradient.addColorStop(1, "rgba(160, 190, 230, 0)");
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        return texture;
    }

    function buildGlowTexture() {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const context = canvas.getContext("2d");
        const gradient = context.createRadialGradient(128, 128, 18, 128, 128, 128);
        gradient.addColorStop(0, "rgba(255, 249, 236, 0.48)");
        gradient.addColorStop(0.22, "rgba(241, 244, 250, 0.26)");
        gradient.addColorStop(0.48, "rgba(217, 228, 245, 0.11)");
        gradient.addColorStop(1, "rgba(217, 228, 245, 0)");
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        return texture;
    }

    // 4. 启动引导
    function bootstrap() {
        initMetaAndCards();
        initSecretEntry();
        ensureScene();

        window.addEventListener("pageshow", ensureScene);
        window.addEventListener(
            "beforeunload",
            () => {
                if (disposeScene) {
                    disposeScene();
                    disposeScene = null;
                }
            },
            { once: true }
        );
    }

    bootstrap();
})();
