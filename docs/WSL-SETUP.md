# Docker Engine in WSL, for Docker Control Centre

This is the setup the app is built for: Docker Engine (not Docker Desktop)
running in a WSL 2 distro, with its API published on `localhost` so Windows
programs can reach it. If you use Docker Desktop instead, skip this page, set
`DOCKER_HOST=npipe:////./pipe/docker_engine`, and choose **On this computer**
for Compose in **Settings**.

## 1. A WSL 2 distro with systemd

In PowerShell:

```powershell
wsl --install -d Ubuntu-24.04
```

Inside the distro, make sure systemd is on. `/etc/wsl.conf` should contain:

```ini
[boot]
systemd=true
```

Then restart WSL from Windows with `wsl --shutdown`, and open the distro again.

## 2. Docker Engine and the Compose plugin

Follow Docker's own instructions for Ubuntu
(<https://docs.docker.com/engine/install/ubuntu/>). The short version:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Log out of the distro and back in, then check with `docker compose version`.

## 3. Publish the API on localhost:2375

Tell `dockerd` to listen on TCP as well as its usual socket, with a systemd
override (setting `hosts` in `daemon.json` clashes with the `-H fd://` the
service already passes):

```bash
sudo mkdir -p /etc/systemd/system/docker.service.d
sudo tee /etc/systemd/system/docker.service.d/override.conf <<'EOF'
[Service]
ExecStart=
ExecStart=/usr/bin/dockerd -H fd:// -H tcp://127.0.0.1:2375
EOF
sudo systemctl daemon-reload
sudo systemctl restart docker
```

WSL forwards `localhost` to Windows, so from Windows this should now work:

```powershell
docker -H tcp://localhost:2375 version
```

> **Security:** port 2375 is the Docker API with no authentication, and the
> Docker API is root on that distro. Keep it bound to `127.0.0.1` as above,
> never `0.0.0.0`.

## 4. Point Windows at it (optional)

Docker Control Centre uses `tcp://localhost:2375` when `DOCKER_HOST` isn't
set, so this step is only for the Windows `docker` CLI and other tools:

```powershell
setx DOCKER_HOST tcp://localhost:2375
```

## 5. Compose in the app

Compose has to run inside WSL, because the engine resolves bind-mount paths
on the Linux side: `./data` in a project on `E:\` must reach the engine as
`/mnt/e/…`. The app does this by default: it runs
`wsl.exe [-d <distro>] --cd <project folder> -- docker compose …`.

Open **Settings** (top right) to pick the distro if Docker isn't in your
default one, and press **Test**: it runs `docker compose version` exactly the
way projects will run.

## Troubleshooting

| Symptom | Check |
|---|---|
| Status bar says "Not connected" | Is the distro running (`wsl -l -v`)? Does `docker -H tcp://localhost:2375 version` work from Windows? |
| Compose actions fail with "wsl.exe isn't installed" | WSL itself isn't installed or isn't on the `PATH`. |
| Test in Settings fails with "docker: command not found" | The chosen distro doesn't have Docker. Pick the one that does. |
| Bind mounts are empty | Compose ran on Windows instead of in WSL: choose **Inside WSL** in Settings. |
