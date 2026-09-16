# ZELVYRA — preparación para publicación

## Estado
Proyecto fuente React + Vite + Capacitor listo para compilar. El entorno de esta sesión no logró completar `npm install`, por lo que no se debe considerar generado un APK/AAB firmado hasta realizar la compilación en un entorno con Node/npm y Android Studio/Xcode.

## Android
1. Instala Node.js LTS y Android Studio.
2. En esta carpeta ejecuta `npm install`.
3. Ejecuta `npm run build`.
4. Ejecuta `npx cap add android` (solo la primera vez).
5. Ejecuta `npx cap sync android`.
6. Ejecuta `npx cap open android`.
7. En Android Studio, genera APK de prueba o AAB firmado para Google Play.

## iPhone / iPad
1. En macOS instala Xcode y Node.js LTS.
2. Ejecuta `npm install`, `npm run build`, `npx cap add ios` y `npx cap sync ios`.
3. Abre con `npx cap open ios`.
4. Configura firma y App Store Connect con una cuenta Apple Developer.

## Identidad
- Nombre: ZELVYRA
- Subtítulo: CONTROL FINANCIERO
- App ID: com.zelvyra.controlfinanciero
- Eslogan: Cada peso tiene un propósito.
