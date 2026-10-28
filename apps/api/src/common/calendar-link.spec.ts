import { prefillCalendarLink, prefillCalendarLinksInText } from './calendar-link';

const GHL = 'https://api.leadconnectorhq.com/widget/booking/abc123';

describe('enlace de agenda con datos prellenados', () => {
  it('GHL: nombre, apellidos, email y teléfono canónico', () => {
    const out = new URL(
      prefillCalendarLink(GHL, { name: 'Emilio Pérez García', email: 'Emilio@Mail.com', phone: '+5215569610721' }),
    );
    expect(out.searchParams.get('first_name')).toBe('Emilio');
    expect(out.searchParams.get('last_name')).toBe('Pérez García');
    expect(out.searchParams.get('email')).toBe('emilio@mail.com');
    expect(out.searchParams.get('phone')).toBe('+525569610721');
  });

  it('omite lo que falta y no inventa nombres a partir de teléfonos', () => {
    const out = new URL(prefillCalendarLink(GHL, { name: '+34 677 10 26 43', email: null, phone: '+34677102643' }));
    expect(out.searchParams.has('first_name')).toBe(false);
    expect(out.searchParams.has('email')).toBe(false);
    expect(out.searchParams.get('phone')).toBe('+34677102643');
  });

  it('respeta parámetros que ya traiga el enlace', () => {
    const out = new URL(prefillCalendarLink(`${GHL}?email=fijo@x.com`, { email: 'otro@x.com' }));
    expect(out.searchParams.get('email')).toBe('fijo@x.com');
  });

  it('Calendly usa name y email', () => {
    const out = new URL(prefillCalendarLink('https://calendly.com/tomas/30min', { name: 'Ana López', email: 'a@x.com', phone: '+34600000000' }));
    expect(out.searchParams.get('name')).toBe('Ana López');
    expect(out.searchParams.get('email')).toBe('a@x.com');
    expect(out.searchParams.has('phone')).toBe(false);
  });

  it('sustituye el enlace dentro del texto aunque vaya sin protocolo o con www.', () => {
    const data = { name: 'Ana', email: 'a@x.com' };
    const txt = `Aquí tienes: api.leadconnectorhq.com/widget/booking/abc123. Y también https://www.api.leadconnectorhq.com/widget/booking/abc123/ ok`;
    const out = prefillCalendarLinksInText(txt, GHL, data);
    expect(out.match(/first_name=Ana/g)?.length).toBe(2);
    expect(out).toMatch(/abc123\?first_name=Ana&email=a%40x\.com\. Y/);
  });

  it('no toca otros enlaces ni rutas más largas', () => {
    const txt = `mira ${GHL}/otra-cosa y https://ejemplo.com`;
    expect(prefillCalendarLinksInText(txt, GHL, { name: 'Ana' })).toBe(txt);
  });

  it('enlace inválido → texto intacto', () => {
    expect(prefillCalendarLink('no es un enlace ::', { name: 'Ana' })).toBe('no es un enlace ::');
  });
});
