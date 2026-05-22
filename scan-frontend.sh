#!/bin/bash
# 扫描前端 API 调用

cd /root/yuwang

echo "{"
first=true

# 获取所有唯一的API路径
grep -rhn "'/api/" src --include="*.vue" --include="*.ts" -o | sort -u | while read -r api_path; do
  # 清理路径
  api_path=$(echo "$api_path" | sed "s/'//g" | sed 's/"//g')
  
  # 找出调用这个API的文件
  files=$(grep -rl "$api_path" src --include="*.vue" --include="*.ts" | sed 's|src/||' | sort -u | tr '\n' ',' | sed 's/,$//')
  
  if [ -n "$files" ]; then
    if [ "$first" = true ]; then
      first=false
    else
      echo ","
    fi
    echo "  \"$api_path\": [$files]"
  fi
done

echo ""
echo "}"
