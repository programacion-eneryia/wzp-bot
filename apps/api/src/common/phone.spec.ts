import {
  canonicalDigits,
  canonicalE164,
  phoneVariants,
  samePhone,
  toE164,
  whatsappDigits,
} from './phone';

describe('teléfonos: formato de WhatsApp frente a E.164 del CRM', () => {
  it('México: 521 + 10 dígitos (WhatsApp) ⇄ +52 + 10 dígitos (CRM)', () => {
    expect(canonicalDigits('5215564507348')).toBe('525564507348');
    expect(canonicalE164('5215564507348@s.whatsapp.net')).toBe('+525564507348');
    expect(whatsappDigits('+525564507348')).toBe('5215564507348');
    expect(samePhone('+525564507348', '5215564507348')).toBe(true);
    expect(phoneVariants('+5215564507348')).toEqual(
      expect.arrayContaining(['+525564507348', '525564507348', '+5215564507348', '5215564507348']),
    );
  });

  it('Argentina: 549 + 10 dígitos (WhatsApp) ⇄ +54 + 10 dígitos (CRM)', () => {
    expect(canonicalDigits('5491112345678')).toBe('541112345678');
    expect(whatsappDigits('+541112345678')).toBe('5491112345678');
    expect(samePhone('+541112345678', '+5491112345678')).toBe(true);
    expect(phoneVariants('+541112345678')).toContain('+5491112345678');
  });

  it('Brasil: móvil con y sin el 9º dígito', () => {
    expect(canonicalDigits('551198765432')).toBe('5511998765432');
    expect(canonicalDigits('5511998765432')).toBe('5511998765432');
    expect(samePhone('+5511998765432', '+551198765432')).toBe(true);
    expect(phoneVariants('+5511998765432')).toContain('+551198765432');
    expect(phoneVariants('+551198765432')).toContain('+5511998765432');
    // Un fijo (empieza por 2-5) no lleva 9 y no se toca.
    expect(canonicalDigits('551133334444')).toBe('551133334444');
  });

  it('el resto de países no cambia', () => {
    expect(canonicalDigits('+34 677 10 26 43')).toBe('34677102643');
    expect(whatsappDigits('34677102643')).toBe('34677102643');
    expect(phoneVariants('+34677102643')).toEqual(['+34677102643', '34677102643']);
    expect(samePhone('+34677102643', '+34677102644')).toBe(false);
  });

  it('identificadores que no son teléfonos', () => {
    expect(toE164('123456789@lid')).toBeNull();
    expect(canonicalE164(null)).toBeNull();
    expect(canonicalE164('Grit•Pointer')).toBeNull();
    expect(samePhone(null, '+34677102643')).toBe(false);
  });
});
