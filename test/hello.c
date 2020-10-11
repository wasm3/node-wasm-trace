#include <stdio.h>
#include <string.h>

int main(int argc, char **argv)
{
  printf("Hello WebAssembly!\n");
  printf("%d, %ld, %f, %lf\n", 1, 2L, 3.f, 4.);
}

