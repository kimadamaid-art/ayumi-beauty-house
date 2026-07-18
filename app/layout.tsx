import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Alex_Brush } from "next/font/google";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const alexBrush = Alex_Brush({
  variable: "--font-alex-brush",
  subsets: ["latin"],
  weight: ["400"],
});

export const metadata: Metadata = {
  title: "Ayumi Beauty House",
  description: "Kecantikan, Kosmetik & Perawatan Diri - Premium Clinic Management System",
};

import ClientLayout from "./ClientLayout";
import { Toaster } from "react-hot-toast";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="id"
      className={`${plusJakartaSans.variable} ${alexBrush.variable} font-sans h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Toaster position="top-center" toastOptions={{ duration: 4000 }} />
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
