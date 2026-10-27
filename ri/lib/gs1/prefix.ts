// Prefijos GS1 de 3 dígitos → organización GS1 que emitió el prefijo (no es necesariamente el país de fabricación).
const R: [number, number, string][] = [
  [0, 19, "GS1 EE. UU. / Canadá"], [30, 39, "GS1 EE. UU."], [60, 139, "GS1 EE. UU. / Canadá"], [300, 379, "GS1 Francia"], [380, 380, "GS1 Bulgaria"], [383, 383, "GS1 Eslovenia"],
  [385, 385, "GS1 Croacia"], [387, 387, "GS1 Bosnia y Herzegovina"], [389, 389, "GS1 Montenegro"], [390, 390, "GS1 Kosovo"], [400, 440, "GS1 Alemania"], [450, 459, "GS1 Japón"], [490, 499, "GS1 Japón"],
  [460, 469, "GS1 Rusia"], [470, 470, "GS1 Kirguistán"], [471, 471, "GS1 Taiwán"], [474, 474, "GS1 Estonia"], [475, 475, "GS1 Letonia"], [476, 476, "GS1 Azerbaiyán"], [477, 477, "GS1 Lituania"],
  [478, 478, "GS1 Uzbekistán"], [479, 479, "GS1 Sri Lanka"], [480, 480, "GS1 Filipinas"], [481, 481, "GS1 Bielorrusia"], [482, 482, "GS1 Ucrania"], [483, 483, "GS1 Turkmenistán"], [484, 484, "GS1 Moldavia"],
  [485, 485, "GS1 Armenia"], [486, 486, "GS1 Georgia"], [487, 487, "GS1 Kazajistán"], [488, 488, "GS1 Tayikistán"], [489, 489, "GS1 Hong Kong"], [500, 509, "GS1 Reino Unido"], [520, 521, "GS1 Grecia"],
  [528, 528, "GS1 Líbano"], [529, 529, "GS1 Chipre"], [530, 530, "GS1 Albania"], [531, 531, "GS1 Macedonia del Norte"], [535, 535, "GS1 Malta"], [539, 539, "GS1 Irlanda"], [540, 549, "GS1 Bélgica y Luxemburgo"],
  [560, 560, "GS1 Portugal"], [569, 569, "GS1 Islandia"], [570, 579, "GS1 Dinamarca"], [590, 590, "GS1 Polonia"], [594, 594, "GS1 Rumania"], [599, 599, "GS1 Hungría"], [600, 601, "GS1 Sudáfrica"],
  [603, 603, "GS1 Ghana"], [604, 604, "GS1 Senegal"], [608, 608, "GS1 Baréin"], [609, 609, "GS1 Mauricio"], [611, 611, "GS1 Marruecos"], [613, 613, "GS1 Argelia"], [615, 615, "GS1 Nigeria"], [616, 616, "GS1 Kenia"],
  [617, 617, "GS1 Camerún"], [618, 618, "GS1 Costa de Marfil"], [619, 619, "GS1 Túnez"], [620, 620, "GS1 Tanzania"], [621, 621, "GS1 Siria"], [622, 622, "GS1 Egipto"], [623, 623, "GS1 Brunéi"], [624, 624, "GS1 Libia"],
  [625, 625, "GS1 Jordania"], [626, 626, "GS1 Irán"], [627, 627, "GS1 Kuwait"], [628, 628, "GS1 Arabia Saudita"], [629, 629, "GS1 Emiratos Árabes Unidos"], [640, 649, "GS1 Finlandia"], [690, 699, "GS1 China"],
  [700, 709, "GS1 Noruega"], [729, 729, "GS1 Israel"], [730, 739, "GS1 Suecia"], [740, 740, "GS1 Guatemala"], [741, 741, "GS1 El Salvador"], [742, 742, "GS1 Honduras"], [743, 743, "GS1 Nicaragua"],
  [744, 744, "GS1 Costa Rica"], [745, 745, "GS1 Panamá"], [746, 746, "GS1 República Dominicana"], [750, 750, "GS1 México"], [754, 755, "GS1 Canadá"], [759, 759, "GS1 Venezuela"], [760, 769, "GS1 Suiza y Liechtenstein"],
  [770, 771, "GS1 Colombia"], [773, 773, "GS1 Uruguay"], [775, 775, "GS1 Perú"], [777, 777, "GS1 Bolivia"], [778, 779, "GS1 Argentina"], [780, 780, "GS1 Chile"], [784, 784, "GS1 Paraguay"], [786, 786, "GS1 Ecuador"],
  [789, 790, "GS1 Brasil"], [800, 839, "GS1 Italia, San Marino y Vaticano"], [840, 849, "GS1 España y Andorra"], [850, 850, "GS1 Cuba"], [858, 858, "GS1 Eslovaquia"], [859, 859, "GS1 República Checa"],
  [860, 860, "GS1 Serbia"], [865, 865, "GS1 Mongolia"], [867, 867, "GS1 Corea del Norte"], [868, 869, "GS1 Turquía"], [870, 879, "GS1 Países Bajos"], [880, 880, "GS1 Corea del Sur"], [883, 883, "GS1 Myanmar"],
  [884, 884, "GS1 Camboya"], [885, 885, "GS1 Tailandia"], [888, 888, "GS1 Singapur"], [890, 890, "GS1 India"], [893, 893, "GS1 Vietnam"], [896, 896, "GS1 Pakistán"], [899, 899, "GS1 Indonesia"], [900, 919, "GS1 Austria"],
  [930, 939, "GS1 Australia"], [940, 949, "GS1 Nueva Zelanda"], [950, 950, "GS1 Global Office"], [951, 951, "GS1 Global Office (EPC)"], [955, 955, "GS1 Malasia"], [958, 958, "GS1 Macao"], [960, 969, "GS1 Global Office (GTIN-8)"],
];
const SPECIAL: [number, number, string][] = [
  [20, 29, "Distribución restringida (uso interno de la empresa)"], [40, 49, "Distribución restringida (uso interno de la empresa)"], [50, 59, "Cupones"], [200, 299, "Distribución restringida (uso interno de la empresa)"],
  [977, 977, "Publicaciones periódicas (ISSN)"], [978, 979, "Libros (ISBN)"], [980, 980, "Recibos de reembolso"], [981, 984, "Cupones de uso común"], [990, 999, "Cupones"],
];
export type PrefixInfo = { kind: "member" | "restricted" | "special"; label: string };
/** Interpreta los primeros dígitos de un GTIN (se completa con ceros a la izquierda hasta 13 dígitos). */
export function prefixInfo(gtin: string): PrefixInfo | null {
  if (!/^\d{8,14}$/.test(gtin)) return null;
  const g = gtin.length === 14 ? gtin.slice(1) : gtin.padStart(13, "0"), p = Number(g.slice(0, 3));
  const sp = SPECIAL.find(([a, b]) => p >= a && p <= b);
  if (sp) return { kind: sp[2].startsWith("Distribución restringida") ? "restricted" : "special", label: sp[2] };
  const m = R.find(([a, b]) => p >= a && p <= b);
  return m ? { kind: "member", label: m[2] } : null;
}
export const isRestricted = (gtin: string) => prefixInfo(gtin)?.kind === "restricted";
