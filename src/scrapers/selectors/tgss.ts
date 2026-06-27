// Registro de selectores TGSS (Sede Electrónica Seguridad Social / Import@ss).
// Versionado y centralizado. Valores con TODO a validar contra el portal real
// durante el desarrollo (sección 4.3 del roadmap).

export const TGSS = {
  version: '2026.06-draft',
  baseUrl: 'https://portal.seg-social.gob.es/',

  // Acceso al Informe de Vida Laboral vía Import@ss
  vidaLaboralEntry: {
    // TODO: validar deep link vigente de Import@ss para Vida Laboral
    url: 'https://portal.seg-social.gob.es/wps/portal/importass/inicio/informeYcertificado/informeVidaLaboral',
    solicitarButton: /informe de vida laboral|solicitar|obtener informe|descargar/i,
  },

  // Identificación Cl@ve (flujo SEDESS / Import@ss)
  identificacion: {
    claveMovilOption: /cl@ve\s*m[oó]vil|cl[aá]ve\s*m[oó]vil/i,
    claveIframe: 'iframe[src*="clave"]',
  },

  // Selección "para mí" vs representante / periodo
  scope: {
    paraMiOption: /para m[ií]|en mi nombre|titular/i,
  },

  // Generación asíncrona del informe + descarga
  download: {
    // El informe puede generarse y aparecer segundos después
    descargarPdfLink: /descargar (informe|pdf)|informe de vida laboral/i,
  },

  errors: {
    informeNoDisponible: /no disponible|no se ha podido generar|sin datos/i,
    accesoDenegado: /acceso denegado|403|forbidden|no autorizado/i,
  },
} as const;
