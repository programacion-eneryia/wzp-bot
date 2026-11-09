import {
  extractResumeDirective,
  formatDateTimeEs,
  formatShortEs,
  timezoneForPhone,
  zonedTimeToUtc,
} from './time';

describe('timezoneForPhone', () => {
  it('reconoce los prefijos habituales', () => {
    expect(timezoneForPhone('+34621374564')).toBe('Europe/Madrid');
    expect(timezoneForPhone('+573152316586')).toBe('America/Bogota');
    expect(timezoneForPhone('+5215510922497')).toBe('America/Mexico_City');
    expect(timezoneForPhone('+593984723161')).toBe('America/Guayaquil');
    expect(timezoneForPhone('+56992247546')).toBe('America/Santiago');
    expect(timezoneForPhone('+18095551234')).toBe('America/Santo_Domingo');
  });
  it('devuelve null si no lo reconoce', () => {
    expect(timezoneForPhone('+12125551234')).toBeNull();
    expect(timezoneForPhone(null)).toBeNull();
    expect(timezoneForPhone('123@lid')).toBeNull();
  });
});

describe('zonedTimeToUtc', () => {
  it('convierte hora local a UTC respetando el horario de verano', () => {
    expect(zonedTimeToUtc({ y: 2026, m: 11, d: 10, h: 10, mi: 0 }, 'Europe/Madrid').toISOString()).toBe(
      '2026-11-10T09:00:00.000Z',
    );
    expect(zonedTimeToUtc({ y: 2026, m: 7, d: 10, h: 10, mi: 0 }, 'Europe/Madrid').toISOString()).toBe(
      '2026-07-10T08:00:00.000Z',
    );
    expect(zonedTimeToUtc({ y: 2026, m: 11, d: 10, h: 19, mi: 0 }, 'America/Bogota').toISOString()).toBe(
      '2026-11-11T00:00:00.000Z',
    );
  });
});

describe('formato en español', () => {
  const t = Date.UTC(2026, 10, 9, 17, 20); // lunes 9 nov 2026 17:20 UTC
  it('fecha larga', () => {
    expect(formatDateTimeEs(t, 'Europe/Madrid')).toBe('lunes 9 de noviembre de 2026, 18:20');
    expect(formatDateTimeEs(t, 'America/Bogota')).toBe('lunes 9 de noviembre de 2026, 12:20');
  });
  it('marca corta', () => {
    expect(formatShortEs(t, 'Europe/Madrid')).toBe('lun 09/11 18:20');
  });
});

describe('extractResumeDirective', () => {
  const now = Date.UTC(2026, 10, 8, 17, 20); // domingo 8 nov 2026 18:20 Madrid
  it('extrae la marca y limpia el texto', () => {
    const r = extractResumeDirective(
      'claro, descansa, hablamos mañana\n[[RETOMAR: 2026-11-09 10:00]]',
      'Europe/Madrid',
      now,
    );
    expect(r.text).toBe('claro, descansa, hablamos mañana');
    expect(r.resumeAt?.toISOString()).toBe('2026-11-09T09:00:00.000Z');
  });
  it('acepta variantes de formato', () => {
    const r = extractResumeDirective('vale [[ retomar: 2026-11-08T19:00 ]]', 'America/Bogota', now);
    expect(r.text).toBe('vale');
    expect(r.resumeAt?.toISOString()).toBe('2026-11-09T00:00:00.000Z');
  });
  it('ignora marcas pasadas, lejanas o inválidas', () => {
    expect(extractResumeDirective('ok [[RETOMAR: 2026-11-08 10:00]]', 'Europe/Madrid', now).resumeAt).toBeNull();
    expect(extractResumeDirective('ok [[RETOMAR: 2027-03-01 10:00]]', 'Europe/Madrid', now).resumeAt).toBeNull();
    expect(extractResumeDirective('ok [[RETOMAR: 2026-13-01 10:00]]', 'Europe/Madrid', now).resumeAt).toBeNull();
    expect(extractResumeDirective('ok sin marca', 'Europe/Madrid', now)).toEqual({ text: 'ok sin marca', resumeAt: null });
  });
});
