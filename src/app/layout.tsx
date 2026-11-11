import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "react-hot-toast";
import { AuthProvider } from "@/contexts/AuthContext";
import { ESCALA_PANEL } from "@/lib/escala";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "HLGAS — Gestión Operativa",
  description: "Sistema Logístico y de Despacho",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className="bg-gray-50"
      style={{
        zoom: ESCALA_PANEL,
        fontSize: '100%',
        // `zoom` no reduce las unidades vh/vw: estas variables las compensan (alto/ancho reales de la ventana).
        ['--alto-pantalla' as string]: `calc(100vh / ${ESCALA_PANEL})`,
        ['--ancho-pantalla' as string]: `calc(100vw / ${ESCALA_PANEL})`,
      }}
    >
      <body className={`${inter.className} overflow-hidden`} style={{ height: 'var(--alto-pantalla)' }}>
        <Toaster position="top-right" />
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
