# ZELVYRA — Control Financiero

Aplicación móvil de finanzas personales con estética gótica elegante: negro, carbón y dorado.

## Versión reutilizable
Esta versión está preparada para que **cada persona empiece desde cero**. No trae una meta personal ni ingresos/gastos precargados.

Al abrirla por primera vez:
- Dinero disponible: **$0**
- Ingresos: **$0**
- Gastos: **$0**
- Ahorro: **$0**
- Meta: sin configurar
- La persona puede elegir **nombre de la meta, monto objetivo y cantidad de meses**.
- También puede indicar ingreso y gastos mensuales estimados, si quiere.

Desde ⚙️ se puede volver a editar la meta y el presupuesto.

## Incluye
- Dinero disponible en tiempo real según movimientos registrados.
- Registro de ingresos, gastos y ahorros.
- Meta de ahorro completamente configurable, y **soporte para múltiples metas de ahorro** (crear, editar, eliminar y elegir a cuál meta destinar cada ahorro).
- Cálculo automático del ahorro mensual y diario necesario.
- Barras y anillo de progreso.
- Presupuesto diario estimado.
- Seguimiento de 6 meses.
- Historial de movimientos con eliminación.
- Calculadora integrada.
- Persistencia local mediante localStorage.
- Manifest PWA, icono y pantalla de inicio.
- Capacitor preparado para Android.

## Importante sobre los datos
Se cambió la clave de almacenamiento a `zelvyra-control-financiero-v2` para que esta versión no reutilice los datos personales de la versión anterior. Así, una instalación nueva comienza limpia.

## Desarrollo
```bash
npm install
npm run dev
npm run build
```

## Android / GitHub Actions
El proyecto incluye un workflow de GitHub Actions en `.github/workflows/android.yml`.
Al hacer push a `main` o `master`, el workflow instala Node.js 24 y Java 17,
crea la plataforma Android de Capacitor y genera automáticamente un APK de prueba.

El APK queda disponible como artefacto `zelvyra-debug-apk` en la ejecución del workflow.

Para trabajar localmente con Android Studio:
```bash
npm install
npm run cap:add:android
npm run cap:sync
npm run cap:open:android
```

Desde Android Studio se puede generar un APK de prueba o un AAB firmado para Google Play.
