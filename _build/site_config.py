# -*- coding: utf-8 -*-
"""部署配置读取 —— 让脚本里不再出现真实的 IP / 主机名 / 口令。

仓库里的这份只含**示例默认值**；真实值放在 `_build/site.local.json`
（已在 .gitignore 里，不会进仓库）。

优先级：环境变量  >  `_build/site.local.json`  >  本文件的示例默认值

首次使用：

    cp _build/site.local.example.json _build/site.local.json
    # 然后把里面 replace-me 的项改成你自己的值

也可以全部走环境变量（适合 CI）：

    XYB_HOST / XYB_HOST_LAN / XYB_SSH_USER / XYB_SSH_PASSWORD
    XYB_WEB_PORT / XYB_API_PORT
"""
import json
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
LOCAL_FILE = os.path.join(_HERE, 'site.local.json')

#: 仓库里公开的示例值 —— 不是任何人的真实部署值，照抄不会连上任何东西
DEFAULTS = {
    'host': 'your-vpn-host',                 # 部署目标机的 VPN 地址（示例，需替换）
    'host_lan': 'your-lan-host',             # 同一台机的局域网地址（示例，需替换）
    'ssh_port': 22,
    'ssh_user': 'replace-me',
    'ssh_password': 'replace-me',
    'web_port': 8099,                        # nginx 静态站端口
    'api_port': 8100,                        # 数据服务端口
    'remote_site_dir': r'C:\workspace\xiaoyuebing',
    'remote_conf_dir': r'C:\workspace\xiaoyuebing-conf',
    'remote_server_dir': r'C:\workspace\xiaoyuebing-server',
    'remote_data_dir': r'C:\workspace\xiaoyuebing-data',
    'remote_python': r'C:\Python313\python.exe',
    'site_container': 'xiaoyuebing',
    'task_name': 'XYBDataServer',
}

_ENV_MAP = {
    'XYB_HOST': 'host',
    'XYB_HOST_LAN': 'host_lan',
    'XYB_SSH_USER': 'ssh_user',
    'XYB_SSH_PASSWORD': 'ssh_password',
    'XYB_WEB_PORT': 'web_port',
    'XYB_API_PORT': 'api_port',
}


def _load():
    cfg = dict(DEFAULTS)
    if os.path.exists(LOCAL_FILE):
        try:
            with open(LOCAL_FILE, encoding='utf-8') as f:
                cfg.update(json.load(f) or {})
        except Exception as e:                      # 配置写坏了要说出来，不能静默
            print('! site.local.json 读取失败：%s' % e)
    for env, key in _ENV_MAP.items():
        v = os.environ.get(env)
        if v:
            cfg[key] = int(v) if key.endswith('port') else v
    return cfg


CFG = _load()


def get(key):
    return CFG[key]


def web_url(host=None, path='', port=None):
    """拼静态站地址；host 默认用局域网地址（家里设备走这条）。"""
    host = host or CFG['host_lan']
    port = port or CFG['web_port']
    return 'http://%s:%d%s' % (host, port, path)


def api_url(path='', host=None):
    """拼数据服务地址。"""
    return 'http://%s:%d%s' % (host or CFG['host'], CFG['api_port'], path)


def is_placeholder():
    """真实值还没填（还是 replace-me）时为 True。"""
    return CFG['ssh_password'] in ('', 'replace-me')


MISSING_CRED_HINT = (
    '未配置部署凭证。请任选其一：\n'
    '  1) 复制 _build/site.local.example.json 为 _build/site.local.json，'
    '填入 ssh_user / ssh_password / host\n'
    '  2) 或设环境变量 XYB_SSH_USER、XYB_SSH_PASSWORD、XYB_HOST')


def ssh_connect(host=None, timeout=20):
    """连上部署目标机。缺配置时**明确报错**，而不是拿着示例值去连。

    host 不传时用配置里的默认地址（通常走 VPN）。
    """
    if is_placeholder():
        raise RuntimeError(MISSING_CRED_HINT)
    import paramiko
    cli = paramiko.SSHClient()
    cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    cli.connect(host or CFG['host'], port=int(CFG['ssh_port']),
                username=CFG['ssh_user'], password=CFG['ssh_password'],
                timeout=timeout, look_for_keys=False, allow_agent=False)
    return cli
