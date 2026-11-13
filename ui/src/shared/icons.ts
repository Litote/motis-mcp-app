// Icons of the buttons, as inline SVG (Unicode arrows change size and weight with the font of the host).

const icon = (path: string, strokeWidth = 2) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;

export const chevronLeft = icon("M15 18l-6-6 6-6");
export const chevronRight = icon("M9 18l6-6-6-6");
export const arrowLeft = icon("M19 12H5M12 19l-7-7 7-7");
export const maximize = icon("M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3");
export const sliders = icon("M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6");
export const check = icon("M20 6L9 17l-5-5", 3);
export const warning = icon("M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01");
