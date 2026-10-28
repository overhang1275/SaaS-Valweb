import { Brand } from "@/components/brand";

export default function ValidationUnavailable() {
  return <main id="main-content" className="standalone-error"><Brand /><h1 className="public-unavailable-title">Validación no disponible</h1><p>Este enlace todavía no está habilitado o ya no está disponible. Contacta a quien te lo compartió.</p></main>;
}
