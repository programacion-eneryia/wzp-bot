import { extractMediaDirectives, matchMedia } from './media-directive';

const ASSETS = [
  { id: 'a1', name: 'Vídeo explicación de la oferta', kind: 'video' },
  { id: 'a2', name: 'Audio presentación', kind: 'audio' },
  { id: 'a3', name: 'PDF precios', kind: 'document' },
];

describe('matchMedia', () => {
  it('encuentra por nombre exacto sin distinguir mayúsculas ni acentos', () => {
    expect(matchMedia('video explicacion de la oferta', ASSETS)?.id).toBe('a1');
    expect(matchMedia('AUDIO PRESENTACIÓN', ASSETS)?.id).toBe('a2');
  });

  it('encuentra por inclusión cuando el modelo acorta el nombre', () => {
    expect(matchMedia('PDF precios', ASSETS)?.id).toBe('a3');
    expect(matchMedia('el vídeo explicación de la oferta que tienes', ASSETS)?.id).toBe('a1');
  });

  it('devuelve null si no hay nada parecido', () => {
    expect(matchMedia('catálogo 2027', ASSETS)).toBeNull();
    expect(matchMedia('', ASSETS)).toBeNull();
  });
});

describe('extractMediaDirectives', () => {
  it('sin marcas devuelve un único tramo con el texto y sin archivo', () => {
    const r = extractMediaDirectives('hola, ¿qué tal?', ASSETS);
    expect(r.hasMedia).toBe(false);
    expect(r.segments).toEqual([{ text: 'hola, ¿qué tal?', media: null }]);
  });

  it('separa texto → archivo → texto', () => {
    const raw =
      'te paso un vídeo donde lo explico mejor\n[[ARCHIVO: Vídeo explicación de la oferta]]\n|||\ndime qué te parece';
    const r = extractMediaDirectives(raw, ASSETS);
    expect(r.hasMedia).toBe(true);
    expect(r.unknown).toEqual([]);
    expect(r.segments).toHaveLength(2);
    expect(r.segments[0].text).toBe('te paso un vídeo donde lo explico mejor');
    expect(r.segments[0].media?.id).toBe('a1');
    expect(r.segments[1].text).toBe('|||\ndime qué te parece');
    expect(r.segments[1].media).toBeNull();
  });

  it('admite sinónimos de la marca y la marca al principio', () => {
    const r = extractMediaDirectives('[[AUDIO: audio presentación]] escúchalo cuando puedas', ASSETS);
    expect(r.segments[0]).toEqual({ text: '', media: ASSETS[1] });
    expect(r.segments[1].text).toBe('escúchalo cuando puedas');
  });

  it('elimina marcas de archivos desconocidos y las reporta', () => {
    const r = extractMediaDirectives('mira esto\n[[ARCHIVO: catálogo 2027]]\n¿te sirve?', ASSETS);
    expect(r.hasMedia).toBe(false);
    expect(r.unknown).toEqual(['catálogo 2027']);
    expect(r.segments).toEqual([{ text: 'mira esto\n\n¿te sirve?', media: null }]);
  });

  it('no envía el mismo archivo dos veces en la misma respuesta', () => {
    const r = extractMediaDirectives(
      '[[ARCHIVO: PDF precios]] aquí tienes [[ARCHIVO: PDF precios]] otra vez',
      ASSETS,
    );
    expect(r.segments.filter((s) => s.media)).toHaveLength(1);
  });
});
