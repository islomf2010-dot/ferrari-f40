import { Canvas } from '@react-three/fiber';
import { PerformanceMonitor, Preload } from '@react-three/drei';
import { Component, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { ACESFilmicToneMapping, PCFShadowMap } from 'three';

import { Director } from './Director.tsx';
import { Ferrari } from './Ferrari.tsx';
import { HotspotProjector } from './HotspotProjector.tsx';
import { Studio } from './Studio.tsx';
import type { QualitySettings } from '../lib/quality.ts';

interface SceneErrorBoundaryProps {
  children: ReactNode;
  onError: (error: Error) => void;
}

interface SceneErrorBoundaryState {
  error: Error | null;
}

/**
 * Model and environment loading both happen inside Suspense; a network blip or
 * a corrupt asset would otherwise leave a blank canvas with no explanation.
 */
class SceneErrorBoundary extends Component<SceneErrorBoundaryProps, SceneErrorBoundaryState> {
  state: SceneErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): SceneErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[F40] scene failed', error, info.componentStack);
    this.props.onError(error);
  }

  render(): ReactNode {
    if (this.state.error) return null;
    return this.props.children;
  }
}

interface ExperienceProps {
  onDprFactorRef: React.MutableRefObject<(factor: number) => void>;
  quality: QualitySettings;
  reducedMotion: boolean;
  onQualityChange: (tier: QualitySettings['tier']) => void;
  onSceneChange: (id: number) => void;
  onReady: () => void;
  onError: (error: Error) => void;
  /** Live resolution scale from PerformanceMonitor, inside the current tier. */
  dpr: [number, number];
}

export function Experience({
  quality,
  reducedMotion,
  onQualityChange,
  onSceneChange,
  onReady,
  onError,
  dpr,
  onDprFactorRef,
}: ExperienceProps) {
  return (
    <Canvas
      className="stage__canvas"
      dpr={dpr}
      shadows={quality.shadows ? { type: PCFShadowMap, enabled: true } : false}
      gl={{
        antialias: quality.tier !== 'low',
        alpha: false,
        powerPreference: 'high-performance',
        stencil: false,
        depth: true,
        preserveDrawingBuffer: false,
      }}
      camera={{ fov: 26, near: 0.12, far: 180, position: [0, 0.9, 12.2] }}
      onCreated={({ gl }) => {
        gl.toneMapping = ACESFilmicToneMapping;
        gl.toneMappingExposure = 0.3;
      }}
    >
      {/* Shifts resolution inside the current quality tier before the governor
          has to give up a whole tier. */}
      <PerformanceMonitor
        ms={220}
        iterations={6}
        threshold={0.72}
        bounds={(refreshrate) => (refreshrate > 90 ? [50, 90] : [42, 58])}
        onChange={({ factor }) => onDprFactorRef.current(factor)}
      />

      <SceneErrorBoundary onError={onError}>
        <Suspense fallback={null}>
          <Studio quality={quality} />
          <Ferrari onLoaded={onReady} />
          {/* Compiles every material before the curtain lifts, so the reveal
              never opens on a stutter. */}
          <Preload all />
        </Suspense>
        <HotspotProjector />
        <Director
          quality={quality.tier}
          onQualityChange={onQualityChange}
          reducedMotion={reducedMotion}
          onSceneChange={onSceneChange}
        />
      </SceneErrorBoundary>
    </Canvas>
  );
}