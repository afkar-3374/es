/**
 * What the visitor is asking for this frame: a move direction (from keys or the
 * on-screen joystick), look changes (mouse or finger drag) and running.
 */
export const input = {
  forward: 0,
  right: 0,
  run: false,
  /** radians, accumulated since last frame */
  lookYaw: 0,
  lookPitch: 0,
  joystick: { x: 0, y: 0 },
};

const keys = new Set<string>();

function refresh() {
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const r = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  input.forward = f;
  input.right = r;
  input.run = keys.has('ShiftLeft') || keys.has('ShiftRight');
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLElement && e.target.closest('input, textarea')) return;
  keys.add(e.code);
  refresh();
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
  refresh();
});
window.addEventListener('blur', () => {
  keys.clear();
  refresh();
});

// Mouse look while the pointer is locked to the world
document.addEventListener('mousemove', (e) => {
  if (!document.pointerLockElement) return;
  input.lookYaw -= e.movementX * 0.0022;
  input.lookPitch -= e.movementY * 0.0022;
});

export const isTouch = matchMedia('(pointer: coarse)').matches;
