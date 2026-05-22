import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import Admin from "./pages/Admin.tsx";
import Session from "./pages/Session.tsx";
import AdminForgotPassword from "./pages/AdminForgotPassword.tsx";
import AdminForgotPasswordVerify from "./pages/AdminForgotPasswordVerify.tsx";
import AdminForgotPasswordReset from "./pages/AdminForgotPasswordReset.tsx";
import NotFound from "./pages/NotFound.tsx";

const RESERVED_CONNECTION_CODES = new Set(["admin", "api"]);

const ConnectionRoute = () => {
  const { connectionCode } = useParams<{ connectionCode?: string }>();

  if (!connectionCode) {
    return <NotFound />;
  }

  if (connectionCode.toLowerCase() === "session") {
    return <LegacySessionRedirect />;
  }

  if (RESERVED_CONNECTION_CODES.has(connectionCode.toLowerCase())) {
    return <NotFound />;
  }

  return <Session />;
};

const LegacySessionRedirect = () => {
  const location = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const joinCode = searchParams.get("joinCode") || searchParams.get("code");

  return <Navigate to={joinCode ? `/${encodeURIComponent(joinCode.trim())}` : "/"} replace state={location.state} />;
};

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/:connectionCode" element={<ConnectionRoute />} />
          <Route path="/admin/forgot-password" element={<AdminForgotPassword />} />
          <Route path="/admin/forgot-password/verify" element={<AdminForgotPasswordVerify />} />
          <Route path="/admin/forgot-password/reset" element={<AdminForgotPasswordReset />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
