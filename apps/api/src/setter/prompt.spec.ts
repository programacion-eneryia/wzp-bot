import { splitBubbles, stripInternalDirectives } from './prompt';

describe('stripInternalDirectives', () => {
  it('quita anotaciones entre corchetes', () => {
    expect(stripInternalDirectives('vale [AÑADIR ETIQUETA: Llamada] te paso el enlace')).toBe('vale te paso el enlace');
  });

  it('no deja restos con corchetes anidados', () => {
    expect(stripInternalDirectives('hasta luego [[RETOMAR: mañana por la tarde]]')).toBe('hasta luego');
    expect(stripInternalDirectives('[[x]]')).toBe('');
  });
});

describe('splitBubbles', () => {
  it('separa por el token y por saltos de línea', () => {
    expect(splitBubbles('hola\n|||\nqué tal?\nbien')).toEqual(['hola', 'qué tal?', 'bien']);
  });

  it('descarta globos sin texto (restos de marcas)', () => {
    expect(splitBubbles('te paso el enlace\n|||\n[[RETOMAR: luego]]\n|||\n…')).toEqual(['te paso el enlace']);
  });
});
