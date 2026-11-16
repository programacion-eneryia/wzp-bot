import { dropInternalReasoning, looksLikeInternalReasoning, stripThinkingBlocks } from './reasoning';

// Casos reales enviados a leads en producción (13 y 14 de noviembre).
const LEAKS = [
  'La semana que viene empieza el lunes 16/11 y "la semana siguiente a la que viene" sería la del 23/11. Eso está dentro de los 10 días vista (hoy es 13/11, y el 23/11 es 10 días exactos). Puedo ofrecerle agendar esa semana',
  'Con "no tengo ahora mismo" es ambiguo — puede significar que tiene poco pero algo, o que literalmente tiene 0. No puedo asumir que tiene menos de 1000€ sin confirmarlo, pero tampoco debo preguntarle directamente cuánto tiene. Voy a reconducir con naturalidad para entender mejor su situación sin preguntarle por dinero directamente',
  'Con 5-10€ no va a poder pagar mi acompañamiento ni arrancar un ecommerce. Le recomiendo el vídeo de YouTube sin ofrecer llamada',
  'El lead no está cualificado, le paso el recurso gratuito',
  'Según las reglas no debo pasar el calendario todavía',
  'Wait, no debo preguntar sobre dinero directamente. Voy a continuar de otra forma',
];

// Mensajes legítimos reales (incluidos los que rozan la heurística).
const LEGIT = [
  'Perfecto, te paso el calendario y coges el hueco que mejor te venga por las tardes',
  'Oye Cristian, siendo sincero contigo, con 5-10€ ahora mismo no podría ayudarte con mi acompañamiento, porque para crear una tienda online hace falta algo más de capital',
  'eso es importante porque el proceso que ofrecemos requiere que la persona tenga ingresos, ya sea como asalariada o independiente, para poder estructurar una cuota sostenible',
  'lo que sí te puedo decir es que para iniciar el proceso la persona necesita poder disponer de alrededor de 1500 dólares',
  'Puedo ofrecerle dos horarios, ¿le viene bien el martes por la tarde?',
  'vale, entiendo',
  'mira Cristian, siendo honesto contigo, para arrancar un ecommerce hace falta algo de inversión, aunque no tiene que ser una barbaridad',
  'cuándo crees que podrías tener algo de capital para empezar?',
  'Cuando lo tengas reservado me dices y confirmamos',
  'https://links.example.com/widget/booking/abc?first_name=Giancarlo',
  'Tranquilo, es solo para que el sistema tenga tus datos antes de la llamada',
  'a veces el sistema tarda un momento en enviar la confirmación, puede que llegue al correo que pusiste al registrarte',
  'entiendo la frustración, Alexis, eso no debería pasar',
  'nadie debería pasar por eso, y menos en su lugar de trabajo',
  'Primero, disculpa por lo de la cita, eso no debería pasar y lo entiendo como una molestia real',
];

describe('looksLikeInternalReasoning', () => {
  it.each(LEAKS)('detecta razonamiento: %s', (t) => {
    expect(looksLikeInternalReasoning(t)).toBe(true);
  });

  it.each(LEGIT)('respeta mensajes legítimos: %s', (t) => {
    expect(looksLikeInternalReasoning(t)).toBe(false);
  });
});

describe('dropInternalReasoning', () => {
  it('separa lo que se envía de lo que se descarta', () => {
    const { kept, dropped } = dropInternalReasoning([LEAKS[2], 'Oye Cristian, te paso un vídeo', 'y me cuentas']);
    expect(dropped).toEqual([LEAKS[2]]);
    expect(kept).toEqual(['Oye Cristian, te paso un vídeo', 'y me cuentas']);
  });
});

describe('stripThinkingBlocks', () => {
  it('quita el bloque privado cerrado', () => {
    expect(
      stripThinkingBlocks('<pensamiento>tiene poco capital, le recomiendo el vídeo</pensamiento>\nOye, te paso un vídeo'),
    ).toBe('Oye, te paso un vídeo');
  });

  it('quita el bloque sin cerrar (respuesta cortada) y variantes en inglés', () => {
    expect(stripThinkingBlocks('hola, qué tal\n<thinking>debo esperar')).toBe('hola, qué tal');
    expect(stripThinkingBlocks('<think>x</think>vale')).toBe('vale');
  });

  it('no toca textos sin bloques', () => {
    expect(stripThinkingBlocks('te viene bien el martes?')).toBe('te viene bien el martes?');
  });
});
