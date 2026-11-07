# Guía Rápida: Puesta en Marcha en Neon + Vercel 🚀

Esta guía te explica cómo poner este sistema en producción en internet en 5 minutos utilizando **Neon (PostgreSQL Serverless)** y **Vercel**.

---

## Paso 1: Crear tu Base de Datos en Neon (Gratis)

1. Ingresa a [neon.tech](https://neon.tech) y crea una cuenta gratuita (puedes entrar con Google o GitHub).
2. Haz clic en **Create Project**.
   * **Nombre:** `obras-cde-db`
   * **Región:** `US East (Ohio)` o la más cercana.
3. Al crearse, verás una pantalla llamada **Connection Details**:
   * Copia la cadena que dice `postgres://...` (Esa es tu `DATABASE_URL`).
4. En el menú de la izquierda de Neon, haz clic en **SQL Editor**:
   * Abre nuestro archivo `schema.sql`.
   * Copia todo el contenido y pégalo en el editor de Neon.
   * Haz clic en el botón verde **Run**.
   * *¡Listo! Ya se crearon las tablas de obras, personales, vales, materiales y Bobcat con datos de ejemplo de CDE.*

---

## Paso 2: Desplegar en Vercel

### Opción A (La más fácil con GitHub):
1. Sube esta carpeta a un repositorio en tu [GitHub](https://github.com).
2. Entra a [vercel.com](https://vercel.com) con tu cuenta de GitHub.
3. Haz clic en **Add New...** > **Project** y selecciona tu repositorio.
4. En la sección **Environment Variables**:
   * **Name:** `DATABASE_URL`
   * **Value:** Pega la URL de conexión que copiaste de Neon en el Paso 1.
5. Haz clic en **Deploy**.
6. En 30 segundos Vercel te dará tu enlace en vivo (ejemplo: `https://obras-cde.vercel.app`).

---

## Paso 3: Conectar n8n a Neon (Para que el Bot guarde todo solo)

En tu n8n local o en la nube:
1. Abre tu flujo y agrega el nodo oficial de **Postgres**.
2. En las credenciales de conexión del nodo Postgres:
   * **Host:** El host de tu Neon (ej: `ep-cool-fog-123456.us-east-2.aws.neon.tech`).
   * **Database:** `neondb`
   * **User:** `neondb_owner`
   * **Password:** La contraseña que te dio Neon.
   * **SSL:** Activado (`require`).
3. Cada vez que llegue un audio o mensaje a WhatsApp, n8n ejecuta un `INSERT` directo en Neon, y la pantalla de Vercel se actualiza automáticamente.
