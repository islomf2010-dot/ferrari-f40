import { useLoader } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { prepareCar, type CarMetrics } from './prepareCar.ts';
import { stage } from './Director.tsx';

export const MODEL_URL = `${import.meta.env.BASE_URL}models/ferrari-f40.draco.glb`;
const DECODER_PATH = `${import.meta.env.BASE_URL}draco/`;

let wired = false;

// One decoder instance for the page. R3F memoises the GLTFLoader itself, so we
// only have to wire the decoder into whichever instance it hands back.
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath(DECODER_PATH);
dracoLoader.preload();

function configure(instance: GLTFLoader): void {
  if (wired) return;
  wired = true;
  instance.setDRACOLoader(dracoLoader);
}

interface FerrariProps {
  onLoaded?: (metrics: CarMetrics) => void;
}

/**
 * The car itself.
 *
 * The GLB is normalised once on load and then left completely alone: from that
 * point on, Director writes the group transform directly. No React state ever
 * touches the model.
 */
export function Ferrari({ onLoaded }: FerrariProps) {
  const gltf = useLoader(GLTFLoader, MODEL_URL, configure) as GLTF;
  const { model, metrics, summary } = useMemo(() => prepareCar(gltf.scene), [gltf]);

  const logged = useRef(false);
  useEffect(() => {
    stage.car = model;
    stage.metrics = metrics;
    if (!logged.current) {
      logged.current = true;
      // eslint-disable-next-line no-console
      console.info(
        `[F40] model ready — ${summary} · ${metrics.size.x.toFixed(2)} × ${metrics.height.toFixed(2)} × ${metrics.size.z.toFixed(2)} m`,
      );
    }
    onLoaded?.(metrics);
    return () => {
      if (stage.car === model) stage.car = null;
    };
  }, [model, metrics, summary, onLoaded]);

  return <primitive object={model} />;
}