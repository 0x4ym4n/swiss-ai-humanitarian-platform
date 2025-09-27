#!/usr/bin/env python
import os
import sys

def main():
    try:
        from dotenv import load_dotenv  # type: ignore
        load_dotenv()
    except Exception:
        pass
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'server.settings')
    from django.core.management import execute_from_command_line
    execute_from_command_line(sys.argv)

if __name__ == '__main__':
    main()



