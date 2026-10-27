import { PerformanceMonitor } from '@react-three/drei';
import { quality } from './quality';

/** Keeps the frame rate up: watches it and moves the quality level (in auto mode). */
export function QualityControl() {
  return <PerformanceMonitor bounds={(refresh) => (refresh > 90 ? [60, 85] : [50, 59])} flipflops={2} onDecline={() => quality.step(-1)} onIncline={() => quality.step(1)} onFallback={() => quality.step(-1)} />;
}
