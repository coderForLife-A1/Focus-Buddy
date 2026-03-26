(() => {
    const body = document.body;
    if (!body) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dprLimit = 2;

    const layer = document.createElement('div');
    layer.className = 'interactive-bg';

    const bgCanvas = document.createElement('canvas');
    bgCanvas.className = 'interactive-bg-canvas';
    layer.appendChild(bgCanvas);
    body.prepend(layer);

    const trailLayer = document.createElement('div');
    trailLayer.className = 'interactive-trail';
    const trailCanvas = document.createElement('canvas');
    trailCanvas.className = 'interactive-trail-canvas';
    trailLayer.appendChild(trailCanvas);
    body.appendChild(trailLayer);

    const bgCtx = bgCanvas.getContext('2d', { alpha: true });
    const trailCtx = trailCanvas.getContext('2d', { alpha: true });
    if (!bgCtx || !trailCtx) return;

    let width = 0;
    let height = 0;
    let animationId = 0;
    let running = true;
    let targetX = window.innerWidth * 0.5;
    let targetY = window.innerHeight * 0.5;

    const pointer = { x: targetX, y: targetY, active: false };
    const trail = Array.from({ length: 28 }, () => ({ x: targetX, y: targetY }));

    const particles = Array.from({ length: prefersReducedMotion ? 18 : 56 }, () => ({
        x: Math.random(),
        y: Math.random(),
        r: 1.0 + Math.random() * 3.6,
        speed: 0.00006 + Math.random() * 0.00028,
        drift: (Math.random() - 0.5) * 0.0003,
        alpha: 0.22 + Math.random() * 0.55,
        hue: 175 + Math.random() * 95,
    }));

    function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, dprLimit);
        width = window.innerWidth;
        height = window.innerHeight;
        bgCanvas.width = Math.floor(width * dpr);
        bgCanvas.height = Math.floor(height * dpr);
        trailCanvas.width = Math.floor(width * dpr);
        trailCanvas.height = Math.floor(height * dpr);
        bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        trailCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function onPointerMove(event) {
        pointer.active = true;
        targetX = event.clientX;
        targetY = event.clientY;
    }

    function onTouchMove(event) {
        if (!event.touches || !event.touches[0]) return;
        pointer.active = true;
        targetX = event.touches[0].clientX;
        targetY = event.touches[0].clientY;
    }

    function onPointerLeave() {
        pointer.active = false;
        targetX = width * 0.5;
        targetY = height * 0.5;
    }

    function drawNebula(time) {
        const t = time * 0.00014;
        const cx1 = width * (0.2 + 0.1 * Math.sin(t * 0.9));
        const cy1 = height * (0.24 + 0.12 * Math.cos(t * 1.2));
        const cx2 = width * (0.78 + 0.08 * Math.cos(t * 1.1));
        const cy2 = height * (0.76 + 0.1 * Math.sin(t * 0.85));

        const g1 = bgCtx.createRadialGradient(cx1, cy1, 0, cx1, cy1, Math.max(width, height) * 0.5);
        g1.addColorStop(0, 'rgba(0, 212, 255, 0.24)');
        g1.addColorStop(1, 'rgba(0, 212, 255, 0)');

        const g2 = bgCtx.createRadialGradient(cx2, cy2, 0, cx2, cy2, Math.max(width, height) * 0.55);
        g2.addColorStop(0, 'rgba(123, 47, 247, 0.2)');
        g2.addColorStop(1, 'rgba(123, 47, 247, 0)');

        bgCtx.fillStyle = g1;
        bgCtx.fillRect(0, 0, width, height);
        bgCtx.fillStyle = g2;
        bgCtx.fillRect(0, 0, width, height);
    }

    function drawParticles(time) {
        const t = time * 0.001;
        for (const p of particles) {
            p.x += p.speed;
            p.y += Math.sin(t + p.x * 7.0) * p.drift;

            if (p.x > 1.08) p.x = -0.08;
            if (p.y > 1.08) p.y = -0.08;
            if (p.y < -0.08) p.y = 1.08;

            const x = p.x * width;
            const y = p.y * height;

            bgCtx.beginPath();
            bgCtx.fillStyle = `hsla(${p.hue}, 95%, 70%, ${p.alpha})`;
            bgCtx.arc(x, y, p.r, 0, Math.PI * 2);
            bgCtx.fill();
        }
    }

    function drawTrail() {
        pointer.x += (targetX - pointer.x) * 0.26;
        pointer.y += (targetY - pointer.y) * 0.26;

        trail[0].x += (pointer.x - trail[0].x) * 0.45;
        trail[0].y += (pointer.y - trail[0].y) * 0.45;

        for (let i = 1; i < trail.length; i++) {
            const previous = trail[i - 1];
            const current = trail[i];
            current.x += (previous.x - current.x) * 0.42;
            current.y += (previous.y - current.y) * 0.42;
        }

        trailCtx.beginPath();
        trailCtx.moveTo(trail[0].x, trail[0].y);
        for (let i = 1; i < trail.length; i++) {
            trailCtx.lineTo(trail[i].x, trail[i].y);
        }
        trailCtx.strokeStyle = pointer.active ? 'rgba(98, 222, 255, 0.25)' : 'rgba(98, 222, 255, 0.12)';
        trailCtx.lineWidth = pointer.active ? 2.4 : 1.4;
        trailCtx.lineCap = 'round';
        trailCtx.lineJoin = 'round';
        trailCtx.stroke();

        for (let i = trail.length - 1; i >= 0; i--) {
            const point = trail[i];
            const glow = (trail.length - i) / trail.length;
            const radius = 2.2 + glow * 10.5;
            const alpha = pointer.active ? 0.12 + glow * 0.34 : 0.05 + glow * 0.16;
            const hue = 180 + glow * 85;

            trailCtx.beginPath();
            trailCtx.fillStyle = `hsla(${hue}, 98%, 68%, ${alpha})`;
            trailCtx.arc(point.x, point.y, radius, 0, Math.PI * 2);
            trailCtx.fill();
        }

        trailCtx.beginPath();
        trailCtx.fillStyle = pointer.active ? 'rgba(174, 243, 255, 0.92)' : 'rgba(174, 243, 255, 0.5)';
        trailCtx.arc(pointer.x, pointer.y, pointer.active ? 4.2 : 3.0, 0, Math.PI * 2);
        trailCtx.fill();
    }

    function animate(time) {
        if (!running) return;

        bgCtx.clearRect(0, 0, width, height);
        trailCtx.clearRect(0, 0, width, height);
        drawNebula(time);
        drawParticles(time);
        drawTrail();

        animationId = window.requestAnimationFrame(animate);
    }

    function onVisibilityChange() {
        running = document.visibilityState === 'visible';
        if (running) {
            window.cancelAnimationFrame(animationId);
            animationId = window.requestAnimationFrame(animate);
        }
    }

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onPointerLeave, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange);

    animationId = window.requestAnimationFrame(animate);
})();
