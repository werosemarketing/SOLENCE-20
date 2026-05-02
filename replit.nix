{pkgs}: {
  deps = [
    pkgs.gtk3
    pkgs.alsa-lib
    pkgs.cairo
    pkgs.pango
    pkgs.mesa
    pkgs.xorg.libxcb
    pkgs.xorg.libX11
    pkgs.xorg.libXrandr
    pkgs.xorg.libXfixes
    pkgs.xorg.libXext
    pkgs.xorg.libXdamage
    pkgs.xorg.libXcomposite
    pkgs.libxkbcommon
    pkgs.libdrm
    pkgs.expat
    pkgs.dbus
    pkgs.cups
    pkgs.at-spi2-core
    pkgs.at-spi2-atk
    pkgs.atk
    pkgs.nss
    pkgs.nspr
    pkgs.glib
  ];
}
