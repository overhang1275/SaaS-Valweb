import Link from "next/link";
import { requireActor } from "@/lib/auth";
import { CsvGuide } from "@/components/csv-guide";
import figure from "@/features/help/csv-figure.json";

export const metadata = { title: "Cómo usar" };

const sections = [
  { id: "registros", label: "Registros CSV" },
  { id: "imagenes", label: "Imágenes" },
  { id: "consulta", label: "Consulta pública" },
];

export default async function HowToPage({ searchParams }: { searchParams: Promise<{ seccion?: string }> }) {
  await requireActor(true);
  const { seccion } = await searchParams;
  const selected = sections.some(section => section.id === seccion) ? seccion : "registros";
  return <div className="howto-page">
    <div className="page-heading"><div><h1>Cómo usar</h1><p>Prepara tus validaciones, publica sus datos y comparte el enlace con confianza.</p></div><Link className="button button-secondary" href="/validaciones">Abrir validaciones</Link></div>
    <nav className="settings-nav" aria-label="Secciones de cómo usar">{sections.map(section => <Link key={section.id} href={`/admin/como-usar?seccion=${section.id}`} aria-current={selected === section.id ? "page" : undefined}>{section.label}</Link>)}</nav>
    {selected === "registros" && <section className="howto-section" aria-labelledby="csv-title">
      <div className="howto-section-heading"><h2 id="csv-title">Cargar y publicar registros</h2><p>Recibir un archivo, revisar una base candidata y publicarla son pasos distintos. Practica el recorrido y después aplícalo desde tu validación.</p></div>
      <CsvGuide figure={figure} />
      <div className="howto-reading"><h3>En tu validación</h3><ol className="howto-steps"><li><strong>Carga el CSV.</strong> Abre Registros y elige un archivo UTF-8 con encabezados.</li><li><strong>Asigna las columnas.</strong> El CSV del ejemplo contiene folio, alfanum y tipo. Asigna cada columna a su campo antes de procesar; otro permite datos adicionales. Elige reemplazar la base o actualizar/agregar registros según corresponda.</li><li><strong>Revisa el resultado.</strong> Corrige errores o duplicados antes de publicar. El worker procesa los archivos en segundo plano.</li><li><strong>Publica la base.</strong> Revisa el resumen y confirma. Después comprueba los requisitos de activación del enlace.</li></ol><p className="howto-note">Publicar una base puede desactivar la validación. Revisa el resultado antes de volver a activarla.</p></div>
    </section>}
    {selected === "imagenes" && <section className="howto-section howto-reading" aria-labelledby="images-title"><div className="howto-section-heading"><h2 id="images-title">Preparar y publicar imágenes</h2><p>Local y NFS son destinos privados del servidor. La consulta recibe las imágenes procesadas, no un enlace abierto a la carpeta.</p></div><ol className="howto-steps"><li><strong>Configura el destino.</strong> En Ajustes generales → Almacenamiento define la raíz Local o NFS. NFS debe estar montado y disponible para Valweb.</li><li><strong>Prepara la validación.</strong> Abre Imágenes, selecciona el destino configurado y crea su carpeta.</li><li><strong>Carga los originales.</strong> Desde el panel usa ZIP o imagen individual. En el modo por registro, el nombre sin extensión debe coincidir con el alfanumérico: ABC101.png corresponde a ABC101, no al folio.</li><li><strong>Procesa y revisa.</strong> Si recibes archivos por FTP, colócalos en por_procesar/ y pulsa Procesar en el panel. Revisa el lote y confirma los reemplazos cuando se solicite. Depositar archivos por FTP no inicia el procesamiento.</li><li><strong>Comprueba la consulta.</strong> En Apariencia → Resultado público habilita Imagen y prueba un código conocido antes de activar.</li></ol><p className="howto-note">Los originales de carpeta se eliminan solo después de publicar y verificar que no cambiaron. Si NFS no está disponible, revisa el montaje; no se cambia automáticamente a Local.</p><Link className="button button-secondary" href="/admin/ajustes?seccion=almacenamiento">Configurar almacenamiento</Link></section>}
    {selected === "consulta" && <section className="howto-section howto-reading" aria-labelledby="public-title"><div className="howto-section-heading"><h2 id="public-title">Activar y compartir una consulta</h2><p>El enlace pertenece a una validación. Tú eliges los campos visibles y si la consulta necesita iniciar sesión.</p></div><ol className="howto-steps"><li><strong>Elige el resultado.</strong> En Apariencia → Resultado público configura folio, alfanumérico, tipo, otros datos e imagen.</li><li><strong>Define quién puede consultar.</strong> Si solicitas acceso con cuenta de cliente, revisa las personas autorizadas. Desde Usuarios → Administrar accesos de consulta puedes asignar usuarios de solo consulta a enlaces protegidos.</li><li><strong>Revisa la disponibilidad.</strong> Necesitas cuenta activa, base publicada con registros y las imágenes requeridas si están habilitadas.</li><li><strong>Activa la validación.</strong> Copia el enlace estable de la ficha y prueba un código conocido y otro inexistente. Buscar un registro y contar con permiso de acceso son condiciones distintas.</li><li><strong>Comparte el enlace.</strong> Para consultas protegidas, entrega también las instrucciones de acceso. Los usuarios de solo consulta entran desde su enlace asignado; no acceden al panel.</li></ol><p className="howto-note">La protección controla el acceso. Quien puede ver una imagen puede capturarla. Retirar el permiso o desactivar la validación bloquea nuevas entregas, pero no borra contenido recibido.</p><Link className="button button-secondary" href="/admin/usuarios/consulta">Revisar usuarios de consulta</Link></section>}
  </div>;
}
