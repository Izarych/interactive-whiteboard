export type ShapeModifier = 'Shift' | 'Alt' | 'Control';
export const shapeModifiers: { value: ShapeModifier; label: string }[] = [{ value: 'Shift', label: 'Shift' }, { value: 'Alt', label: 'Alt' }, { value: 'Control', label: 'Ctrl' }];
const key = 'bluviboard:shape-modifier';
export function storedShapeModifier(): ShapeModifier {
  try { const stored = localStorage.getItem(key); if (shapeModifiers.some((item) => item.value === stored)) return stored as ShapeModifier; } catch { /* Session preference remains usable. */ }
  return 'Shift';
}
export function saveShapeModifier(value: ShapeModifier) {
  try { localStorage.setItem(key, value); } catch { /* Session preference remains usable. */ }
}
export function modifierHeld(event: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean }, modifier: ShapeModifier) {
  return modifier === 'Shift' ? event.shiftKey : modifier === 'Alt' ? event.altKey : event.ctrlKey;
}
