// Registro de selectores AEAT (Sede Electrónica Agencia Tributaria).
// Versionado y centralizado: cualquier cambio de la sede se parchea aquí.
// IMPORTANTE: los valores marcados con TODO deben validarse contra el portal
// real durante el desarrollo del scraper (sección 4.2 del roadmap). Se priorizan
// anclas semánticas (rol/texto) sobre clases ofuscadas.

export const AEAT = {
  version: '2026.06-draft',
  baseUrl: 'https://sede.agenciatributaria.gob.es/',

  // Acceso a Renta. RUTA VALIDADA: irpf.html → "Consulta de declaraciones
  // presentadas" (lleva al selector de acceso SelectorAccesos.html) → Cl@ve Móvil.
  // NO usar "Servicio tramitación…": fuerza certificado y devuelve 403.
  rentaEntry: {
    url: 'https://sede.agenciatributaria.gob.es/Sede/irpf.html',
    accederButton: /consulta de declaraciones presentadas/i,
  },

  // Página de selección de método ("Identifícate con", SelectorAccesos.html)
  identificacion: {
    claveMovilOption: /cl@ve\s*m[oó]vil|cl[aá]ve\s*m[oó]vil/i,
    // En AEAT la pantalla Cl@ve es top-level (no iframe), pero se deja el fallback.
    claveIframe: 'iframe[src*="clave"]',
  },

  // Selección de ejercicio fiscal (solo Renta)
  ejercicio: {
    selectFiscalYear: 'select[name*="ejercicio"], select#ejercicio', // TODO validar
  },

  // Generación / descarga del PDF
  download: {
    descargarPdfButton: /descargar|obtener pdf|generar pdf|exportar/i,
  },

  // Señales de error / WAF
  errors: {
    sinDeclaracion: /no (existe|consta) declaraci|sin datos/i,
    accesoDenegado: /acceso denegado|403|forbidden|no autorizado/i,
  },
} as const;
