import os
import re
import json

SRC_DIR = '/root/yuwang/src'
API_PATTERN = re.compile(r"['\"](/api/[^'\"]+)['\"]")

def scan_frontend():
    usage = {}
    
    for root, dirs, files in os.walk(SRC_DIR):
        for file in files:
            if file.endswith('.vue') or file.endswith('.ts'):
                filepath = os.path.join(root, file)
                rel_path = os.path.relpath(filepath, SRC_DIR)
                
                try:
                    with open(filepath, 'r', encoding='utf-8') as f:
                        content = f.read()
                    
                    # 找出所有 API 调用
                    matches = API_PATTERN.findall(content)
                    for api_path in set(matches):
                        # 标准化路径（移除动态参数）
                        clean_path = re.sub(r'/\d+', '/:id', api_path)
                        if clean_path not in usage:
                            usage[clean_path] = []
                        if rel_path not in usage[clean_path]:
                            usage[clean_path].append(rel_path)
                except:
                    pass
    
    return usage

if __name__ == '__main__':
    result = scan_frontend()
    
    # 保存结果
    with open('/root/api-manager/frontend-usage.json', 'w') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    
    print(f'扫描完成，发现 {len(result)} 个 API 被前端调用')
    for path, files in sorted(result.items()):
        print(f'  {path}: {", ".join(files)}')
