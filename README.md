# Luggo · Red social de reseñas

Luggo es una aplicación social para compartir reseñas de lugares. Este repositorio contiene la base con React + Vite en el frontend y Supabase como backend-as-a-service (PostgreSQL, autenticación, almacenamiento y funcionalidades en tiempo real).

## Stack principal
- [React](https://react.dev/) + [Vite](https://vite.dev/) para un frontend veloz y modular.
- [Supabase](https://supabase.com/) como servicio administrado que cubre base de datos PostgreSQL, Auth, Storage y APIs.
- ESLint con la configuración recomendada para mantener un estilo consistente.

## Requisitos previos
- Node.js >= 20.x
- npm >= 10.x

## Configuración rápida
1. Copia el archivo de ejemplo: `cp .env.example .env.local`.
2. Coloca tu `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` dentro de `.env.local` (los obtienes del dashboard de Supabase).
3. Instala dependencias con `npm install`.
4. Levanta el entorno de desarrollo con `npm run dev`.

## Scripts disponibles
- `npm run dev`: inicia el servidor de desarrollo con HMR.
- `npm run build`: genera la versión optimizada para producción.
- `npm run preview`: sirve localmente la compilación generada.
- `npm run lint`: ejecuta ESLint sobre el proyecto.

## Estructura de carpetas
```
proyectov2/
├── public/
├── src/
│   ├── assets/
│   │   ├── images/
│   │   │   ├── nav/        # Íconos de la barra de navegación inferior
│   │   │   ├── profile/    # Placeholders o avatares por defecto
│   │   │   └── actions/    # Íconos para like/dislike/follow
│   │   └── react.svg
│   ├── lib/
│   │   └── supabaseClient.js
│   ├── App.jsx
│   ├── App.css
│   ├── main.jsx
│   └── index.css
├── .env.example
└── README.md
```
Cada subcarpeta de `src/assets/images` incluye un `.gitkeep` para conservarla en el repositorio aunque aún no existan archivos. Sustituye los placeholders con tus íconos definitivos conforme avance el diseño.

## Cliente de Supabase
El archivo `src/lib/supabaseClient.js` crea una instancia única de Supabase usando las variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. El módulo lanza una excepción descriptiva si las variables no existen, lo que ayuda a detectar configuraciones incompletas desde el arranque.

En `src/App.jsx` encontrarás una verificación básica que consulta la tabla `instruments`. Puedes cambiarla por tus tablas reales (por ejemplo `places`, `reviews` o `profiles`) para validar rápidamente que la conexión funcione con tus datos.

## Próximos pasos sugeridos
- Definir los esquemas de tablas (usuarios, lugares, reseñas, seguidores) directamente en Supabase y documentarlos.
- Implementar autenticación (correo + magic links o proveedores OAuth) usando los helpers de Supabase.
- Añadir un mapa interactivo (Mapbox/Leaflet) que consuma los datos almacenados.
- Diseñar los componentes responsivos para la navegación inferior y los listados de reseñas.
