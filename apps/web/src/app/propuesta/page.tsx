import type { Metadata } from "next";
import Propuesta from "./Propuesta";

export const metadata: Metadata = {
  title: "Propuesta UX/UI — WZP",
  description: "Boceto de rediseño del dashboard. Página paralela, no toca el producto real.",
};

export default function PropuestaPage() {
  return <Propuesta />;
}
