import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useToast } from "@/components/ui/use-toast";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const AdminForgotPasswordVerify = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const email = location.state?.email || "";
  
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await api.adminVerifyOtp(email, otp);
      toast({
        title: "Success",
        description: "OTP verified successfully. Please reset your password.",
      });
      navigate("/admin/forgot-password/reset", { state: { email, otp } });
    } catch (error) {
      toast({
        title: "Invalid OTP",
        description: "The OTP you entered is invalid or has expired. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    try {
      await api.adminForgotPassword(email);
      toast({
        title: "Success",
        description: "A new OTP has been sent to your email.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to resend OTP. Please try again.",
        variant: "destructive",
      });
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">Verify OTP</CardTitle>
          <CardDescription className="text-center">
            Enter the 6-digit OTP sent to your admin email
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="otp" className="text-sm font-medium">
                OTP Code
              </label>
              <Input
                id="otp"
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="Enter 6-digit OTP"
                maxLength={6}
                required
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Email: <span className="font-medium">{email}</span>
              </p>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Verifying..." : "Verify OTP"}
            </Button>
          </form>
          <div className="mt-4 text-center">
            <Button variant="link" onClick={handleResend} disabled={resending}>
              {resending ? "Resending..." : "Resend OTP"}
            </Button>
          </div>
          <div className="mt-2 text-center">
            <Button variant="link" onClick={() => navigate("/admin/forgot-password")}>
              Back to Forgot Password
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminForgotPasswordVerify;
