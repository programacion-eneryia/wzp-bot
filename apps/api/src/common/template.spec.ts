import { greetingName, templateSkeleton } from './template';

const tpl = (name: string) =>
  `Hola ${name} , soy David 👋\r\n\r\nAcabo de ver que has rellenado el formulario para recibir los recursos sobre cómo crear y escalar una Marca Privada de ecommerce.\r\n\r\nTe puedo pasar por aquí el acceso a la comunidad donde están todos los recursos.\r\n\r\n¿Quieres que te lo envíe?`;

describe('templateSkeleton', () => {
  it('es el mismo para la plantilla con distintos nombres', () => {
    expect(templateSkeleton(tpl('Desiree González Jiménez'))).toBe(templateSkeleton(tpl('Marleck')));
    expect(templateSkeleton(tpl('Ana'))).toContain('Acabo de ver que has rellenado');
  });
  it('ignora diferencias de espacios y saltos de línea', () => {
    expect(templateSkeleton(tpl('Ana').replace(/\r\n/g, '\n').replace(/ {1}/g, '  '))).toBe(templateSkeleton(tpl('Ana')));
  });
  it('no identifica mensajes de una línea o cortos', () => {
    expect(templateSkeleton('Hola Ronny! ¿Qué tal te va?')).toBeNull();
    expect(templateSkeleton('Que tal Juan soy David\nte he llamado')).toBeNull();
  });
});

describe('greetingName', () => {
  it('saca el nombre del saludo', () => {
    expect(greetingName(tpl('Desiree González Jiménez'))).toBe('Desiree González Jiménez');
    expect(greetingName('Hola Marleck, soy David 👋\n\nAcabo de ver…')).toBe('Marleck');
    expect(greetingName('Hola Paulo Fernando , soy David! 👋\n…')).toBe('Paulo Fernando');
    expect(greetingName('Ey José Alberto! recordarte que mañana…')).toBe('José Alberto');
  });
  it('devuelve null si no hay nombre', () => {
    expect(greetingName('Hola, soy David')).toBeNull();
    expect(greetingName('Acabo de ver el video')).toBeNull();
    expect(greetingName('Hola buenas')).toBeNull();
  });
});
