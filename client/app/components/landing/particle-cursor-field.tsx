"use client";

import { useEffect, useRef } from "react";

type ParticleCursorFieldProps = {
  className?: string;
  particleCount?: number;
  lineDistance?: number;
  speed?: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
};

const PARTICLE_MARGIN = 40;
const POINTER_RADIUS = 190;
const POINTER_RADIUS_SQ = POINTER_RADIUS * POINTER_RADIUS;

const randomBetween = (min: number, max: number): number => Math.random() * (max - min) + min;

export function ParticleCursorField({
  className,
  particleCount = 42,
  lineDistance = 145,
  speed = 1,
}: ParticleCursorFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = {
      x: window.innerWidth * 0.5,
      y: window.innerHeight * 0.5,
      active: false,
    };

    let isHidden = document.hidden;
    let shouldReduceMotion = reduceMotionQuery.matches;
    let width = window.innerWidth;
    let height = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let frameId = 0;
    let particles: Particle[] = [];

    const getParticleCount = (): number => {
      const mobileCount = Math.floor(particleCount * 0.58);
      return window.innerWidth < 768 ? Math.max(18, mobileCount) : particleCount;
    };

    const createParticle = (): Particle => ({
      x: randomBetween(-PARTICLE_MARGIN, width + PARTICLE_MARGIN),
      y: randomBetween(-PARTICLE_MARGIN, height + PARTICLE_MARGIN),
      vx: randomBetween(-0.26, 0.26) * speed,
      vy: randomBetween(-0.26, 0.26) * speed,
      size: randomBetween(0.6, 2.1),
    });

    const seedParticles = () => {
      particles = Array.from({ length: getParticleCount() }, createParticle);
    };

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      seedParticles();
      drawFrame(false, performance.now());
    };

    const wrap = (particle: Particle) => {
      if (particle.x < -PARTICLE_MARGIN) particle.x = width + PARTICLE_MARGIN;
      if (particle.x > width + PARTICLE_MARGIN) particle.x = -PARTICLE_MARGIN;
      if (particle.y < -PARTICLE_MARGIN) particle.y = height + PARTICLE_MARGIN;
      if (particle.y > height + PARTICLE_MARGIN) particle.y = -PARTICLE_MARGIN;
    };

    const drawConnections = () => {
      const maxDistanceSq = lineDistance * lineDistance;
      for (let i = 0; i < particles.length; i += 1) {
        const source = particles[i];
        for (let j = i + 1; j < particles.length; j += 1) {
          const target = particles[j];
          const dx = source.x - target.x;
          const dy = source.y - target.y;
          const distanceSq = dx * dx + dy * dy;
          if (distanceSq >= maxDistanceSq) continue;

          const distance = Math.sqrt(distanceSq);
          const alpha = (1 - distance / lineDistance) * 0.24;
          context.strokeStyle = `rgba(125, 198, 228, ${alpha})`;
          context.lineWidth = 0.75;
          context.beginPath();
          context.moveTo(source.x, source.y);
          context.lineTo(target.x, target.y);
          context.stroke();
        }
      }
    };

    const drawParticles = () => {
      for (const particle of particles) {
        const glow = particle.size * 1.8;
        const gradient = context.createRadialGradient(
          particle.x,
          particle.y,
          0,
          particle.x,
          particle.y,
          glow,
        );
        gradient.addColorStop(0, "rgba(171, 233, 255, 0.84)");
        gradient.addColorStop(1, "rgba(171, 233, 255, 0)");
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(particle.x, particle.y, glow, 0, Math.PI * 2);
        context.fill();
      }
    };

    const updateParticles = (timeMs: number) => {
      const driftStrength = 0.013 * speed;
      for (let i = 0; i < particles.length; i += 1) {
        const particle = particles[i];

        if (pointer.active) {
          const dx = pointer.x - particle.x;
          const dy = pointer.y - particle.y;
          const distanceSq = dx * dx + dy * dy;
          if (distanceSq > 0.0001 && distanceSq < POINTER_RADIUS_SQ) {
            const distance = Math.sqrt(distanceSq);
            const pull = (1 - distance / POINTER_RADIUS) * 0.05 * speed;
            particle.vx += (dx / distance) * pull;
            particle.vy += (dy / distance) * pull;
          }
        }

        particle.vx += Math.sin(timeMs * 0.00055 + i) * driftStrength;
        particle.vy += Math.cos(timeMs * 0.00045 + i * 0.6) * driftStrength;
        particle.vx *= 0.972;
        particle.vy *= 0.972;
        particle.x += particle.vx;
        particle.y += particle.vy;
        wrap(particle);
      }
    };

    const drawFrame = (animate: boolean, timeMs: number) => {
      context.clearRect(0, 0, width, height);

      const backdrop = context.createRadialGradient(
        pointer.x,
        pointer.y,
        0,
        pointer.x,
        pointer.y,
        Math.max(width, height) * 0.62,
      );
      backdrop.addColorStop(0, "rgba(20, 52, 68, 0.18)");
      backdrop.addColorStop(1, "rgba(20, 52, 68, 0)");
      context.fillStyle = backdrop;
      context.fillRect(0, 0, width, height);

      if (animate) updateParticles(timeMs);
      drawConnections();
      drawParticles();
    };

    const stop = () => {
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
        frameId = 0;
      }
    };

    const animate = (timeMs: number) => {
      if (isHidden || shouldReduceMotion) return;
      drawFrame(true, timeMs);
      frameId = window.requestAnimationFrame(animate);
    };

    const start = () => {
      stop();
      if (isHidden || shouldReduceMotion) {
        drawFrame(false, performance.now());
        return;
      }
      frameId = window.requestAnimationFrame(animate);
    };

    const handlePointerMove = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.active = true;
    };

    const handlePointerLeave = () => {
      pointer.active = false;
      pointer.x = width * 0.5;
      pointer.y = height * 0.35;
    };

    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      pointer.x = touch.clientX;
      pointer.y = touch.clientY;
      pointer.active = true;
    };

    const handleTouchEnd = () => {
      pointer.active = false;
    };

    const handleVisibility = () => {
      isHidden = document.hidden;
      start();
    };

    const handleReduceMotion = () => {
      shouldReduceMotion = reduceMotionQuery.matches;
      start();
    };

    resize();
    start();

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerleave", handlePointerLeave);
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    document.addEventListener("visibilitychange", handleVisibility);
    reduceMotionQuery.addEventListener("change", handleReduceMotion);

    return () => {
      stop();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", handlePointerLeave);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      document.removeEventListener("visibilitychange", handleVisibility);
      reduceMotionQuery.removeEventListener("change", handleReduceMotion);
    };
  }, [lineDistance, particleCount, speed]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
