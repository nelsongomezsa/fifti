import type { Metadata } from "next";
import { DemoApp } from "@/components/demo/DemoApp";

export const metadata: Metadata = { title: "Demo", description: "Prueba Fifti con datos ficticios, sin registro." };

export default function DemoPage() {
  return <DemoApp />;
}
