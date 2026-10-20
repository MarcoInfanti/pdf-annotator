# PDF Annotator

Visor de PDF en el navegador para subrayar texto y añadir comentarios en Markdown. Las anotaciones
se guardan **dentro del propio PDF**, sin base de datos ni servidor: al volver a abrir el archivo
aparecen de nuevo.

## Funcionalidades

- Subrayado de texto en cuatro colores.
- Comentarios en Markdown (con tablas), con vista previa; se pueden añadir, editar y eliminar.
- Las anotaciones se guardan en el PDF de dos formas:
  - una copia JSON completa, para restaurarlas exactamente en esta app;
  - subrayados estándar de PDF con el comentario, visibles en Acrobat, Edge y otros lectores.
- En Chrome y Edge se guarda sobre el mismo archivo (File System Access API); en otros navegadores
  se descarga una copia anotada.
- Exportar / importar las anotaciones como JSON (copia de seguridad y PDFs protegidos).
- Zoom (Ctrl + rueda, Ctrl +/−, ajustar al ancho), modos de lectura Normal / Sepia / Noche y panel
  lateral redimensionable con búsqueda.

## Privacidad

Todo ocurre en tu navegador: los PDF no se suben a ningún servidor.

## Desarrollo

Requiere Node.js 20 o superior.

```bash
npm install
npm start            # servidor de desarrollo en http://localhost:4200
npm run build        # compilación de producción en dist/
npm test             # tests unitarios (Karma + Jasmine)
npm run e2e          # tests end-to-end (Playwright, Chromium)
```

La primera vez que ejecutes los tests e2e instala el navegador con `npx playwright install chromium`.

Hecho con Angular 20, [pdf.js](https://mozilla.github.io/pdf.js/) para mostrar el PDF,
[pdf-lib](https://pdf-lib.js.org/) para escribir las anotaciones y [marked](https://marked.js.org/)
para el Markdown.

## Licencia

[MIT](LICENSE) © 2026 Marco Infanti
