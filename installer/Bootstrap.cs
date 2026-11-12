using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;

class Bootstrap {
    [STAThread]
    static int Main() {
        Application.EnableVisualStyles();
        string temporary = Path.Combine(Path.GetTempPath(), "HomeGrocery-" + Guid.NewGuid().ToString("N"));
        try {
            Directory.CreateDirectory(temporary);
            string archive = Path.Combine(temporary, "payload.zip");
            using (Stream source = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
            using (FileStream output = File.Create(archive)) source.CopyTo(output);
            ZipFile.ExtractToDirectory(archive, Path.Combine(temporary, "payload"));
            string script = Path.Combine(temporary, "payload", "installer", "Setup.ps1");
            var info = new ProcessStartInfo("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -STA -File \"" + script + "\"");
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            using (var process = Process.Start(info)) { process.WaitForExit(); return process.ExitCode; }
        } catch (Exception error) {
            MessageBox.Show("Home Grocery could not open setup.\n\n" + error.Message, "Home Grocery", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        } finally {
            // Only this uniquely-created extraction directory is ever removed.
            try { if (Directory.Exists(temporary)) Directory.Delete(temporary, true); } catch { }
        }
    }
}
